#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

#include "checker.hpp"
#include "error.hpp"
#include "fmt.hpp"
#ifndef QWQ_ANALYZE_ONLY
#include "interpreter.hpp"
#endif
#include "lexer.hpp"
#include "parser.hpp"
#include "provenance.hpp"

namespace {

#ifndef QWQ_ANALYZE_ONLY
constexpr std::int64_t kBrowserStepLimit = 1'000'000;
#endif

char* copyString(const std::string& value) {
  char* copy = static_cast<char*>(std::malloc(value.size() + 1));
  if (copy == nullptr) return nullptr;
  std::memcpy(copy, value.data(), value.size());
  copy[value.size()] = '\0';
  return copy;
}

std::string jsonString(const std::string& value) {
  static constexpr char hex[] = "0123456789abcdef";
  std::string escaped;
  escaped.reserve(value.size() + 2);
  escaped += '"';
  for (const unsigned char character : value) {
    switch (character) {
      case '"': escaped += "\\\""; break;
      case '\\': escaped += "\\\\"; break;
      case '\b': escaped += "\\b"; break;
      case '\f': escaped += "\\f"; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default:
        if (character < 0x20) {
          escaped += "\\u00";
          escaped += hex[character >> 4];
          escaped += hex[character & 0x0f];
        } else {
          escaped += static_cast<char>(character);
        }
    }
  }
  escaped += '"';
  return escaped;
}

const char* tokenKindName(qwq::Token::Kind kind) {
  using Kind = qwq::Token::Kind;
  switch (kind) {
    case Kind::VoidPort: return "VoidPort";
    case Kind::IntPort: return "IntPort";
    case Kind::StrPort: return "StrPort";
    case Kind::BoolPort: return "BoolPort";
    case Kind::IntLiteral: return "IntLiteral";
    case Kind::StringLiteral: return "StringLiteral";
    case Kind::LeftParen: return "LeftParen";
    case Kind::RightParen: return "RightParen";
    case Kind::LeftBracket: return "LeftBracket";
    case Kind::RightBracket: return "RightBracket";
    case Kind::LeftBrace: return "LeftBrace";
    case Kind::RightBrace: return "RightBrace";
    case Kind::Comma: return "Comma";
    case Kind::Underscore: return "Underscore";
    case Kind::Compose: return "Compose";
    case Kind::Tee: return "Tee";
    case Kind::Coerce: return "Coerce";
    case Kind::Loop: return "Loop";
    case Kind::Branch: return "Branch";
    case Kind::Identifier: return "Identifier";
    case Kind::Arrow: return "Arrow";
    case Kind::FatArrow: return "FatArrow";
    case Kind::Equals: return "Equals";
    case Kind::Operator: return "Operator";
    case Kind::Comment: return "Comment";
    case Kind::End: return "End";
  }
  return "Unknown";
}

std::size_t diagnosticEnd(std::size_t start, const std::vector<qwq::Token>& tokens,
                          std::size_t sourceSize) {
  for (const qwq::Token& token : tokens) {
    if (token.kind == qwq::Token::Kind::End) continue;
    const std::size_t end = token.position + token.spelling.size();
    if (start >= token.position && start < end) return end;
  }
  return start < sourceSize ? start + 1 : start;
}

void appendDiagnostic(std::ostringstream& output, const std::string& phase,
                      const std::string& message, std::size_t position,
                      const std::vector<qwq::Token>& tokens,
                      std::size_t sourceSize) {
  output << "{\"phase\":" << jsonString(phase) << ",\"message\":"
         << jsonString(message);
  if (position == qwq::Error::npos) {
    output << ",\"start\":null,\"end\":null}";
  } else {
    output << ",\"start\":" << position << ",\"end\":"
           << diagnosticEnd(position, tokens, sourceSize) << '}';
  }
}

std::string tokenJson(const std::vector<qwq::Token>& tokens) {
  std::ostringstream output;
  output << '[';
  bool first = true;
  for (const qwq::Token& token : tokens) {
    if (token.kind == qwq::Token::Kind::End) continue;
    if (!first) output << ',';
    first = false;
    output << "{\"kind\":" << jsonString(tokenKindName(token.kind))
           << ",\"start\":" << token.position << ",\"end\":"
           << token.position + token.spelling.size() << '}';
  }
  output << ']';
  return output.str();
}

std::string provenanceJson(const qwq::web::Provenance& provenance) {
  std::ostringstream output;
  output << "{\"origins\":[";
  for (std::size_t index = 0; index < provenance.origins.size(); ++index) {
    if (index != 0) output << ',';
    const qwq::web::FlowOrigin& origin = provenance.origins[index];
    output << "{\"id\":" << jsonString(origin.id)
           << ",\"anchor\":" << origin.anchor << '}';
  }
  output << "],\"flow\":[";
  for (std::size_t index = 0; index < provenance.marks.size(); ++index) {
    if (index != 0) output << ',';
    const qwq::web::FlowMark& mark = provenance.marks[index];
    output << "{\"start\":" << mark.start << ",\"end\":"
           << mark.end << ",\"sources\":[";
    for (std::size_t source = 0; source < mark.origins.size(); ++source) {
      if (source != 0) output << ',';
      output << jsonString(mark.origins[source]);
    }
    output << ']';
    if (!mark.signatures.empty()) {
      output << ",\"signatures\":[";
      for (std::size_t signatureIndex = 0;
           signatureIndex < mark.signatures.size(); ++signatureIndex) {
        if (signatureIndex != 0) output << ',';
        const qwq::web::FlowSignature& signature =
            mark.signatures[signatureIndex];
        output << "{\"text\":" << jsonString(signature.text)
               << ",\"declaration\":";
        if (signature.hasDeclaration) output << signature.declaration;
        else output << "null";
        output << '}';
      }
      output << ']';
    }
    output << ",\"color\":" << (mark.color ? "true" : "false") << '}';
  }
  output << "]}";
  return output.str();
}

std::string errorResult(const std::vector<qwq::Token>& tokens,
                        const std::string& phase, const std::string& message,
                        std::size_t position, std::size_t sourceSize) {
  std::ostringstream output;
  output << "{\"ok\":false,\"tokens\":" << tokenJson(tokens)
         << ",\"diagnostics\":[";
  appendDiagnostic(output, phase, message, position, tokens, sourceSize);
  output << "]}";
  return output.str();
}

#ifndef QWQ_ANALYZE_ONLY
std::string runErrorResult(const std::string& partialOutput,
                           const std::string& phase,
                           const std::string& message, std::size_t position,
                           const std::vector<qwq::Token>& tokens,
                           std::size_t sourceSize) {
  std::ostringstream output;
  output << "{\"ok\":false,\"output\":" << jsonString(partialOutput)
         << ",\"diagnostics\":[";
  appendDiagnostic(output, phase, message, position, tokens, sourceSize);
  output << "]}";
  return output.str();
}

std::string runSuccessResult(const std::string& programOutput) {
  return "{\"ok\":true,\"output\":" + jsonString(programOutput) +
         ",\"diagnostics\":[]}";
}
#endif

}  // namespace

extern "C" char* qwq_analyze(const char* input) {
  const std::string source = input == nullptr ? "" : input;
  std::vector<qwq::Token> tokens;
  try {
    tokens = qwq::tokenize(source, /*keepComments=*/true);
  } catch (const qwq::Error& error) {
    return copyString(errorResult({}, "lex", error.what(), error.position(),
                                  source.size()));
  } catch (const std::exception& error) {
    return copyString(errorResult({}, "internal", error.what(), qwq::Error::npos,
                                  source.size()));
  }

  qwq::Program program;
  try {
    program = qwq::parse(tokens);
  } catch (const qwq::Error& error) {
    return copyString(errorResult(tokens, "syntax", error.what(), error.position(),
                                  source.size()));
  } catch (const std::exception& error) {
    return copyString(errorResult(tokens, "internal", error.what(), qwq::Error::npos,
                                  source.size()));
  }

  try {
    qwq::check(program);
  } catch (const qwq::Error& error) {
    return copyString(errorResult(tokens, "type", error.what(), error.position(),
                                  source.size()));
  } catch (const std::exception& error) {
    return copyString(errorResult(tokens, "internal", error.what(), qwq::Error::npos,
                                  source.size()));
  }

  qwq::web::Provenance provenance;
  try {
    provenance = qwq::web::analyzeProvenance(program, tokens);
  } catch (const std::exception&) {
    // Provenance is an editor enhancement; it must not block type checking.
  }

  std::ostringstream output;
  output << "{\"ok\":true,\"tokens\":" << tokenJson(tokens)
         << ",\"diagnostics\":[],\"provenance\":"
         << provenanceJson(provenance) << '}';
  return copyString(output.str());
}

extern "C" char* qwq_format(const char* input) {
  try {
    return copyString(qwq::format(input == nullptr ? "" : input));
  } catch (...) {
    return nullptr;
  }
}

#ifndef QWQ_ANALYZE_ONLY
extern "C" char* qwq_run(const char* sourceInput, const char* runtimeInput) {
  const std::string source = sourceInput == nullptr ? "" : sourceInput;
  const std::string input = runtimeInput == nullptr ? "" : runtimeInput;
  std::vector<qwq::Token> tokens;
  try {
    tokens = qwq::tokenize(source, /*keepComments=*/true);
  } catch (const qwq::Error& error) {
    return copyString(runErrorResult("", "lex", error.what(), error.position(),
                                     tokens, source.size()));
  } catch (const std::exception& error) {
    return copyString(runErrorResult("", "internal", error.what(),
                                     qwq::Error::npos, tokens, source.size()));
  }

  qwq::Program program;
  try {
    program = qwq::parse(tokens);
  } catch (const qwq::Error& error) {
    return copyString(runErrorResult("", "syntax", error.what(), error.position(),
                                     tokens, source.size()));
  } catch (const std::exception& error) {
    return copyString(runErrorResult("", "internal", error.what(),
                                     qwq::Error::npos, tokens, source.size()));
  }

  try {
    qwq::check(program);
    if (program.main && !program.main->in.empty()) {
      throw qwq::Error(
          "program is not closed: it consumes a stream of type " +
              qwq::toString(program.main->in) +
              ", but a program must start from the empty stream o "
              "(every input has to be produced by the program itself)",
          program.main->position);
    }
  } catch (const qwq::Error& error) {
    return copyString(runErrorResult("", "type", error.what(), error.position(),
                                     tokens, source.size()));
  } catch (const std::exception& error) {
    return copyString(runErrorResult("", "internal", error.what(),
                                     qwq::Error::npos, tokens, source.size()));
  }

  if (!program.main) return copyString(runSuccessResult(""));

  std::istringstream inputStream(input);
  std::ostringstream outputStream;
  try {
    qwq::Interpreter interpreter(outputStream, inputStream, kBrowserStepLimit,
                                  program.definitions, nullptr,
                                  &program.specializations);
    for (const qwq::Value& value : interpreter.run(*program.main, {})) {
      outputStream << value;
    }
  } catch (const qwq::Error& error) {
    return copyString(runErrorResult(outputStream.str(), "runtime", error.what(),
                                     error.position(), tokens, source.size()));
  } catch (const std::exception& error) {
    return copyString(runErrorResult(outputStream.str(), "runtime", error.what(),
                                     qwq::Error::npos, tokens, source.size()));
  }
  return copyString(runSuccessResult(outputStream.str()));
}
#endif

extern "C" void qwq_free(char* memory) { std::free(memory); }
