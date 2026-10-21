#include "provenance.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "type.hpp"

namespace qwq::web {
namespace {

using Sources = std::set<std::string>;

Sources singleSource(const Sources& sources) {
  if (sources.empty()) return {};
  return {*sources.begin()};
}

struct FlowValue {
  TypePtr type;
  Sources sources;
  std::vector<FlowValue> children;

  bool isPack() const {
    return type && type->kind == Type::Kind::Pack && children.size() == 2;
  }
};

using FlowStream = std::vector<FlowValue>;

std::size_t leafCount(const TypePtr& type) {
  if (!type) return 0;
  if (type->kind == Type::Kind::Pack) {
    return leafCount(type->left) + leafCount(type->right);
  }
  return 1;
}

std::size_t leafCount(const StreamType& type) {
  return type.empty() ? 0 : leafCount(type.value);
}

void refreshSources(FlowValue& value) {
  if (!value.isPack()) return;
  value.sources.clear();
  for (const FlowValue& child : value.children) {
    value.sources.insert(child.sources.begin(), child.sources.end());
  }
}

FlowValue valueWithSources(const TypePtr& type, const Sources& sources) {
  FlowValue value;
  value.type = type;
  if (type && type->kind == Type::Kind::Pack) {
    value.children.push_back(valueWithSources(type->left, sources));
    value.children.push_back(valueWithSources(type->right, sources));
    refreshSources(value);
  } else {
    value.sources = singleSource(sources);
  }
  return value;
}

FlowValue valueFromLeaves(const TypePtr& type,
                          const std::vector<Sources>& leaves,
                          std::size_t& index) {
  FlowValue value;
  value.type = type;
  if (type && type->kind == Type::Kind::Pack) {
    value.children.push_back(valueFromLeaves(type->left, leaves, index));
    value.children.push_back(valueFromLeaves(type->right, leaves, index));
    refreshSources(value);
  } else {
    if (index < leaves.size()) value.sources = singleSource(leaves[index]);
    ++index;
  }
  return value;
}

FlowValue packValue(const TypePtr& type, FlowValue left, FlowValue right) {
  FlowValue value;
  value.type = type;
  value.children.push_back(std::move(left));
  value.children.push_back(std::move(right));
  refreshSources(value);
  return value;
}

void appendLeafSources(const FlowValue& value, std::vector<Sources>& result) {
  if (value.isPack()) {
    appendLeafSources(value.children[0], result);
    appendLeafSources(value.children[1], result);
  } else {
    result.push_back(value.sources);
  }
}

std::vector<Sources> leafSources(const FlowStream& stream) {
  std::vector<Sources> result;
  for (const FlowValue& value : stream) appendLeafSources(value, result);
  return result;
}

Sources allSources(const FlowStream& stream) {
  Sources result;
  for (const FlowValue& value : stream) {
    result.insert(value.sources.begin(), value.sources.end());
  }
  return result;
}

FlowValue mergeValues(const FlowValue& first, const FlowValue& second) {
  if (first.type && second.type && equals(first.type, second.type) &&
      first.isPack() && second.isPack()) {
    return packValue(first.type,
                     mergeValues(first.children[0], second.children[0]),
                     mergeValues(first.children[1], second.children[1]));
  }

  const TypePtr type = first.type ? first.type : second.type;
  const Sources& sources = first.sources.empty() ? second.sources : first.sources;
  return valueWithSources(type, sources);
}

FlowStream mergeStreams(const FlowStream& first, const FlowStream& second) {
  if (first.empty()) return second;
  if (second.empty()) return first;
  const std::size_t count = std::min(first.size(), second.size());
  FlowStream result;
  result.reserve(std::max(first.size(), second.size()));
  for (std::size_t index = 0; index < count; ++index) {
    result.push_back(mergeValues(first[index], second[index]));
  }
  for (std::size_t index = count; index < first.size(); ++index) {
    result.push_back(first[index]);
  }
  for (std::size_t index = count; index < second.size(); ++index) {
    result.push_back(second[index]);
  }
  return result;
}

bool sameValue(const FlowValue& first, const FlowValue& second) {
  if ((!first.type) != (!second.type)) return false;
  if (first.type && !equals(first.type, second.type)) return false;
  if (first.children.size() != second.children.size()) return false;
  if (first.sources != second.sources) return false;
  for (std::size_t index = 0; index < first.children.size(); ++index) {
    if (!sameValue(first.children[index], second.children[index])) return false;
  }
  return true;
}

bool sameStream(const FlowStream& first, const FlowStream& second) {
  if (first.size() != second.size()) return false;
  for (std::size_t index = 0; index < first.size(); ++index) {
    if (!sameValue(first[index], second[index])) return false;
  }
  return true;
}

class OriginRegistry {
 public:
  std::string site(std::size_t position) {
    const std::string id = "site:" + std::to_string(position);
    add(id, position);
    return id;
  }

  std::string parameter(const Definition& definition, std::size_t index,
                        std::size_t anchor) {
    std::string id = "param:" + std::to_string(definition.position) + ":";
    if (!definition.templateInstanceKey.empty()) {
      id += definition.templateInstanceKey + ":";
    }
    id += std::to_string(index);
    add(id, anchor);
    return id;
  }

  void add(const std::string& id, std::size_t anchor) {
    const auto found = origins_.find(id);
    if (found == origins_.end()) {
      origins_.emplace(id, anchor);
    } else {
      found->second = std::min(found->second, anchor);
    }
  }

  std::vector<FlowOrigin> values() const {
    std::vector<FlowOrigin> result;
    result.reserve(origins_.size());
    for (const auto& [id, anchor] : origins_) result.push_back({id, anchor});
    std::sort(result.begin(), result.end(), [](const FlowOrigin& first,
                                               const FlowOrigin& second) {
      if (first.anchor != second.anchor) return first.anchor < second.anchor;
      return first.id < second.id;
    });
    return result;
  }

 private:
  std::map<std::string, std::size_t> origins_;
};

class FlowRecorder {
 public:
  explicit FlowRecorder(const std::vector<Token>& tokens) {
    for (const Token& token : tokens) {
      if (token.kind == Token::Kind::End) continue;
      tokenEnds_.emplace(token.position, token.position + token.spelling.size());
      tokenSpellings_.emplace(token.position, token.spelling);
    }
  }

  void mark(std::size_t position, const Sources& sources, bool color = true) {
    if (sources.empty()) return;
    const auto found = tokenEnds_.find(position);
    if (found == tokenEnds_.end()) return;
    RangeSources& target = marks_[{position, found->second}];
    target.sources.insert(sources.begin(), sources.end());
    target.color = target.color || color;
  }

  std::string spellingAt(std::size_t position) const {
    const auto found = tokenSpellings_.find(position);
    return found == tokenSpellings_.end() ? "operation" : found->second;
  }

  void markSignature(std::size_t position, const FlowSignature& signature) {
    const auto found = tokenEnds_.find(position);
    if (found == tokenEnds_.end()) return;
    RangeSources& target = marks_[{position, found->second}];
    if (std::find(target.signatures.begin(), target.signatures.end(), signature) ==
        target.signatures.end()) {
      target.signatures.push_back(signature);
    }
  }

  std::vector<FlowMark> values() const {
    std::vector<FlowMark> result;
    result.reserve(marks_.size());
    for (const auto& [range, data] : marks_) {
      result.push_back({range.first, range.second,
                        std::vector<std::string>(data.sources.begin(), data.sources.end()),
                        data.color, data.signatures});
    }
    return result;
  }

 private:
  struct RangeSources {
    Sources sources;
    bool color = false;
    std::vector<FlowSignature> signatures;
  };

  std::map<std::size_t, std::size_t> tokenEnds_;
  std::map<std::size_t, std::string> tokenSpellings_;
  std::map<std::pair<std::size_t, std::size_t>, RangeSources> marks_;
};

bool portIsEmpty(const Port& port);

bool partIsEmpty(const PortPart& part) {
  switch (part.kind) {
    case PortPart::Kind::Primitive:
      return part.type.empty();
    case PortPart::Kind::Array:
    case PortPart::Kind::Named:
      return false;
    case PortPart::Kind::Group:
      return part.inner && portIsEmpty(*part.inner);
    case PortPart::Kind::Expression:
      return part.expression && part.expression->in.empty();
  }
  return false;
}

bool portIsEmpty(const Port& port) {
  for (const PortPart& part : port.parts) {
    if (!partIsEmpty(part)) return false;
  }
  return true;
}

std::vector<std::size_t> portPartIndices(const Port& port,
                                         std::vector<bool>& emptyParts) {
  std::vector<std::size_t> nonempty;
  emptyParts.resize(port.parts.size(), false);
  for (std::size_t index = 0; index < port.parts.size(); ++index) {
    emptyParts[index] = partIsEmpty(port.parts[index]);
    if (!emptyParts[index]) nonempty.push_back(index);
  }
  return nonempty;
}

void appendPartAnchors(const PortPart& part, const StreamType& type,
                       std::vector<std::size_t>& result);

void appendPortAnchors(const Port& port, const StreamType& type,
                       std::vector<std::size_t>& result) {
  std::vector<bool> emptyParts;
  const std::vector<std::size_t> nonempty = portPartIndices(port, emptyParts);
  if (nonempty.empty()) return;

  StreamType remainder = type;
  std::vector<StreamType> resolvedParts(port.parts.size());
  std::size_t remainingNonempty = nonempty.size();
  for (std::size_t reverse = port.parts.size(); reverse > 0; --reverse) {
    const std::size_t index = reverse - 1;
    if (emptyParts[index]) continue;

    if (remainingNonempty > 1 && !remainder.empty() &&
        remainder.value->kind == Type::Kind::Pack) {
      resolvedParts[index] = StreamType(remainder.value->right);
      remainder = StreamType(remainder.value->left);
    } else {
      resolvedParts[index] = remainder;
      remainder = {};
    }
    --remainingNonempty;
  }

  for (std::size_t index = 0; index < port.parts.size(); ++index) {
    if (!emptyParts[index]) {
      appendPartAnchors(port.parts[index], resolvedParts[index], result);
    }
  }
}

void appendPartAnchors(const PortPart& part, const StreamType& type,
                       std::vector<std::size_t>& result) {
  if (type.empty()) return;
  switch (part.kind) {
    case PortPart::Kind::Primitive:
    case PortPart::Kind::Array:
    case PortPart::Kind::Named:
    case PortPart::Kind::Expression: {
      const std::size_t count = leafCount(type);
      for (std::size_t index = 0; index < count; ++index) {
        result.push_back(part.position);
      }
      return;
    }
    case PortPart::Kind::Group:
      if (part.inner) appendPortAnchors(*part.inner, type, result);
      return;
  }
}

std::vector<std::size_t> portAnchors(const Port& port,
                                     const StreamType& type) {
  std::vector<std::size_t> result;
  appendPortAnchors(port, type, result);
  return result;
}

std::vector<Sources> streamLeaves(const FlowStream& stream) {
  return leafSources(stream);
}

void markPort(const Port& port, const StreamType& type,
              const FlowStream& stream, FlowRecorder& recorder) {
  const std::vector<std::size_t> anchors = portAnchors(port, type);
  if (anchors.empty()) return;
  const std::vector<Sources> leaves = streamLeaves(stream);
  if (leaves.empty()) return;

  if (anchors.size() == 1) {
    Sources combined;
    for (const Sources& leaf : leaves) {
      combined.insert(leaf.begin(), leaf.end());
    }
    recorder.mark(anchors.front(), combined);
    return;
  }

  for (std::size_t index = 0; index < anchors.size(); ++index) {
    const std::size_t leaf = leaves.size() == 1 ? 0 : std::min(index, leaves.size() - 1);
    recorder.mark(anchors[index], leaves[leaf]);
  }
}

FlowStream streamFromLeaves(const StreamType& type,
                            const std::vector<Sources>& leaves) {
  if (type.empty()) return {};
  std::size_t index = 0;
  return {valueFromLeaves(type.value, leaves, index)};
}

FlowStream streamWithSources(const StreamType& type, const Sources& sources) {
  if (type.empty()) return {};
  return {valueWithSources(type.value, sources)};
}

FlowStream convertStream(const FlowStream& stream, const StreamType& target) {
  if (target.empty()) return {};
  if (stream.empty()) return streamWithSources(target, {});
  if (stream.size() == 1 && stream.front().type &&
      equals(stream.front().type, target.value)) {
    return stream;
  }

  const std::vector<Sources> leaves = leafSources(stream);
  if (leaves.size() == leafCount(target)) {
    return streamFromLeaves(target, leaves);
  }
  return streamWithSources(target, allSources(stream));
}

std::pair<FlowStream, FlowStream> splitStream(const FlowStream& stream,
                                               const StreamType& leftType,
                                               const StreamType& rightType) {
  if (leftType.empty()) return {{}, stream};
  if (rightType.empty()) return {stream, {}};
  if (stream.size() == 1 && stream.front().isPack()) {
    return {{stream.front().children[0]}, {stream.front().children[1]}};
  }
  if (stream.size() == 1 && leafCount(leftType) + leafCount(rightType) == 1) {
    return {leftType.empty() ? FlowStream{} : stream,
            rightType.empty() ? FlowStream{} : FlowStream{}};
  }
  return {stream, {}};
}

FlowStream joinStreams(const FlowStream& left, const FlowStream& right,
                       const StreamType& outputType) {
  if (left.empty()) return right;
  if (right.empty()) return left;
  if (left.size() != 1 || right.size() != 1 || outputType.empty()) {
    return mergeStreams(left, right);
  }
  return {packValue(outputType.value, left.front(), right.front())};
}

std::vector<std::size_t> expressionInputAnchors(const Expr& expr,
                                                const StreamType& type) {
  switch (expr.kind) {
    case Expr::Kind::Wire:
      return portAnchors(expr.domain, type);
    case Expr::Kind::Face:
    case Expr::Kind::Call:
      if (expr.hasDomain) return portAnchors(expr.domain, type);
      break;
    case Expr::Kind::Compose:
    case Expr::Kind::Tee:
    case Expr::Kind::Coerce:
      return expressionInputAnchors(*expr.left, type);
    case Expr::Kind::Append: {
      std::vector<std::size_t> result =
          expressionInputAnchors(*expr.left, expr.left->in);
      std::vector<std::size_t> right =
          expressionInputAnchors(*expr.right, expr.right->in);
      result.insert(result.end(), right.begin(), right.end());
      if (!result.empty()) return result;
      break;
    }
    case Expr::Kind::Loop:
    case Expr::Kind::Branch:
      return expressionInputAnchors(*expr.right, type);
  }

  return std::vector<std::size_t>(leafCount(type), expr.position);
}

FlowStream makeParameterStream(const Definition& instance,
                               const Definition& sourceDefinition,
                               OriginRegistry& origins) {
  const std::size_t count = leafCount(instance.in);
  if (count == 0) return {};
  std::vector<std::size_t> anchors =
      portAnchors(sourceDefinition.domain, instance.in);
  if (anchors.size() < count) {
    anchors.resize(count, sourceDefinition.position);
  } else if (anchors.size() > count) {
    anchors.resize(count);
  }

  std::vector<Sources> leaves;
  leaves.reserve(count);
  for (std::size_t index = 0; index < count; ++index) {
    leaves.push_back({origins.parameter(instance, index, anchors[index])});
  }
  return streamFromLeaves(instance.in, leaves);
}

class FlowEvaluator {
 public:
  FlowEvaluator(const Program& program, OriginRegistry& origins,
                FlowRecorder& recorder)
      : program_(program), origins_(origins), recorder_(recorder) {}

  FlowStream evaluate(const Expr& expr, const FlowStream& incoming,
                      bool record) {
    if (analysisSteps_ >= kFlowStepBudget) {
      return streamWithSources(expr.out, allSources(incoming));
    }
    ++analysisSteps_;
    const FlowStream input = convertStream(incoming, expr.in);
    if (record) {
      if (expr.kind == Expr::Kind::Wire) {
        markPort(expr.domain, expr.in, input, recorder_);
      } else if (expr.hasDomain) {
        markPort(expr.domain, expr.in, input, recorder_);
      }
    }

    FlowStream output;
    switch (expr.kind) {
      case Expr::Kind::Wire:
        output = input;
        break;
      case Expr::Kind::Face:
        output = evaluateFace(expr, input, record);
        break;
      case Expr::Kind::Call:
        output = evaluateCall(expr, input);
        break;
      case Expr::Kind::Compose: {
        FlowStream intermediate = evaluate(*expr.left, input, record);
        intermediate = convertStream(intermediate, expr.right->in);
        output = evaluate(*expr.right, intermediate, record);
        break;
      }
      case Expr::Kind::Tee: {
        const FlowStream intermediate = evaluate(*expr.left, input, record);
        output = evaluate(*expr.right, intermediate, record);
        break;
      }
      case Expr::Kind::Coerce: {
        FlowStream intermediate = evaluate(*expr.left, input, record);
        intermediate = convertStream(intermediate, expr.right->in);
        output = evaluate(*expr.right, intermediate, record);
        break;
      }
      case Expr::Kind::Append: {
        const auto [leftInput, rightInput] =
            splitStream(input, expr.left->in, expr.right->in);
        const FlowStream left = evaluate(*expr.left, leftInput, record);
        const FlowStream right = evaluate(*expr.right, rightInput, record);
        output = joinStreams(left, right, expr.out);
        break;
      }
      case Expr::Kind::Branch:
        output = evaluateBranch(expr, input, record);
        break;
      case Expr::Kind::Loop:
        output = evaluateLoop(expr, input, record);
        break;
    }

    output = convertStream(output, expr.out);
    if (expr.kind == Expr::Kind::Call || expr.kind == Expr::Kind::Branch ||
        expr.kind == Expr::Kind::Loop || expr.kind == Expr::Kind::Coerce) {
      output = expr.out.empty()
                   ? FlowStream{}
                   : streamWithSources(expr.out, {sourceAt(expr.position)});
    }

    if (record && expr.kind == Expr::Kind::Face) {
      const bool literal = expr.core == Core::IntLiteral ||
                           expr.core == Core::StringLiteral ||
                           expr.core == Core::BoolLiteral;
      if (literal) {
        recorder_.mark(expr.corePosition, allSources(output), true);
      } else {
        const FlowSignature signature{
            recorder_.spellingAt(expr.corePosition) + "(" + toString(expr.in) +
                " -> " + toString(expr.out) + ")",
            false,
            0,
        };
        recorder_.markSignature(expr.corePosition, signature);
      }
    }
    if (record && expr.kind == Expr::Kind::Call) {
      FlowSignature signature;
      signature.text = expr.text + "(" + toString(expr.in) + " -> " +
                       toString(expr.out) + ")";
      if (const Definition* definition = findDefinition(expr)) {
        signature.hasDeclaration = true;
        signature.declaration = definition->position;
      }
      recorder_.markSignature(expr.position, signature);
    } else if (record && expr.kind != Expr::Kind::Wire &&
               expr.kind != Expr::Kind::Face &&
               !(expr.kind == Expr::Kind::Compose && expr.implicitComposition)) {
      recorder_.markSignature(
          expr.position,
          {recorder_.spellingAt(expr.position) + "(" + toString(expr.in) +
               " -> " + toString(expr.out) + ")",
           false,
           0});
    }
    if (record && expr.hasCodomain) {
      markPort(expr.codomain, expr.out, output, recorder_);
    }
    return output;
  }

  void beginDefinition(const Definition* definition) {
    callStack_.push_back(definition);
  }

  void endDefinition() {
    if (!callStack_.empty()) callStack_.pop_back();
  }

 private:
  const Program& program_;
  OriginRegistry& origins_;
  FlowRecorder& recorder_;
  std::vector<const Definition*> callStack_;
  static constexpr std::size_t kFlowStepBudget = 150000;
  std::size_t analysisSteps_ = 0;

  std::string sourceAt(std::size_t position) {
    return origins_.site(position);
  }

  const Definition* findDefinition(const Expr& expr) const {
    if (!expr.templateInstanceKey.empty()) {
      for (const Definition& definition : program_.specializations) {
        if (definition.name == expr.text &&
            definition.templateInstanceKey == expr.templateInstanceKey &&
            equals(definition.in, expr.in) && equals(definition.out, expr.out)) {
          return &definition;
        }
      }
    }

    for (const Definition& definition : program_.definitions) {
      if (definition.name == expr.text && definition.templateParameters.empty() &&
          equals(definition.in, expr.in) && equals(definition.out, expr.out)) {
        return &definition;
      }
    }
    return nullptr;
  }

  FlowStream evaluateCall(const Expr& expr, const FlowStream& input) {
    const Definition* definition = findDefinition(expr);
    if (definition == nullptr || !definition->body) {
      return streamWithSources(expr.out, allSources(input));
    }
    if (callStack_.size() >= 64 ||
        std::find(callStack_.begin(), callStack_.end(), definition) !=
            callStack_.end()) {
      return streamWithSources(expr.out, allSources(input));
    }

    const FlowStream callInput = convertStream(input, definition->in);
    callStack_.push_back(definition);
    FlowStream output = evaluate(*definition->body, callInput, false);
    callStack_.pop_back();
    return convertStream(output, expr.out);
  }

  FlowStream evaluateFace(const Expr& expr, const FlowStream& input,
                          bool record) {
    const Sources inputSources = allSources(input);
    switch (expr.core) {
      case Core::IntLiteral:
      case Core::StringLiteral:
      case Core::BoolLiteral: {
        const Sources source{sourceAt(expr.corePosition)};
        return streamWithSources(expr.out, source);
      }
      case Core::Read: {
        const Sources source{sourceAt(expr.corePosition)};
        return streamWithSources(expr.out, source);
      }
      case Core::ArrayLiteral: {
        for (const ExprPtr& element : expr.elements) {
          if (element) evaluate(*element, {}, record);
        }
        return streamWithSources(expr.out, {sourceAt(expr.corePosition)});
      }
      case Core::Duplicate: {
        if (input.empty() || expr.out.empty()) return {};
        const FlowValue original = input.front();
        if (expr.out.value->kind == Type::Kind::Pack &&
            expr.out.value->left && expr.out.value->right) {
          return {packValue(expr.out.value, original, original)};
        }
        return streamWithSources(expr.out, inputSources);
      }
      case Core::Swap: {
        if (input.size() == 1 && input.front().isPack() && !expr.out.empty() &&
            expr.out.value->kind == Type::Kind::Pack) {
          return {packValue(expr.out.value, input.front().children[1],
                            input.front().children[0])};
        }
        return streamFromLeaves(expr.out, leafSources(input));
      }
      case Core::Reshape: {
        const std::vector<Sources> leaves = leafSources(input);
        return streamFromLeaves(expr.out, leaves);
      }
      case Core::ArrayDefault:
        return streamWithSources(expr.out, {sourceAt(expr.corePosition)});
      case Core::ArrayFill:
      case Core::Index:
      case Core::ArrayWrite:
      case Core::ArrayLength:
      case Core::Negate:
      case Core::Not:
      case Core::Add:
      case Core::Sub:
      case Core::Mul:
      case Core::Div:
      case Core::Mod:
      case Core::BitOr:
      case Core::BitAnd:
      case Core::BitXor:
      case Core::Equal:
      case Core::NotEqual:
      case Core::Greater:
      case Core::Less:
      case Core::GreaterEqual:
      case Core::LessEqual:
      case Core::Hash:
        return streamWithSources(expr.out, {sourceAt(expr.corePosition)});
    }
    return streamWithSources(expr.out, inputSources);
  }

  FlowStream evaluateBranch(const Expr& expr, const FlowStream& input,
                            bool record) {
    const FlowStream condition = evaluate(*expr.left, input, record);
    FlowStream payload;
    if (condition.size() == 1 && condition.front().isPack()) {
      payload = {condition.front().children[1]};
    } else {
      payload = convertStream(input, expr.out);
    }
    FlowStream body = evaluate(*expr.right, payload, record);
    return mergeStreams(payload, body);
  }

  FlowStream evaluateLoop(const Expr& expr, const FlowStream& input,
                          bool record) {
    FlowStream state = input;
    FlowStream exits;
    constexpr std::size_t kFlowIterations = 32;

    for (std::size_t iteration = 0; iteration < kFlowIterations; ++iteration) {
      const FlowStream condition = evaluate(*expr.left, state, record);

      FlowStream payload;
      if (condition.size() == 1 && condition.front().isPack()) {
        payload = {condition.front().children[1]};
      } else {
        payload = state;
      }
      exits = mergeStreams(exits, payload);
      const FlowStream body = evaluate(*expr.right, payload, record);
      const FlowStream next = mergeStreams(payload, body);
      if (sameStream(state, next)) {
        state = next;
        break;
      }
      state = next;
    }

    if (exits.empty()) exits = state;
    return exits;
  }
};

FlowStream mainInput(const Expr& expression, OriginRegistry& origins) {
  const std::size_t count = leafCount(expression.in);
  if (count == 0) return {};
  std::vector<std::size_t> anchors = expressionInputAnchors(expression, expression.in);
  if (anchors.size() < count) anchors.resize(count, expression.position);
  if (anchors.size() > count) anchors.resize(count);

  std::vector<Sources> leaves;
  leaves.reserve(count);
  for (std::size_t index = 0; index < count; ++index) {
    const std::string id = "main-input:" + std::to_string(anchors[index]) + ":" +
                           std::to_string(index);
    origins.add(id, anchors[index]);
    leaves.push_back({id});
  }
  return streamFromLeaves(expression.in, leaves);
}

const Definition* templateSource(const Program& program,
                                const Definition& instance) {
  for (const Definition& definition : program.definitions) {
    if (!definition.templateParameters.empty() &&
        definition.name == instance.name &&
        definition.position == instance.position) {
      return &definition;
    }
  }
  return nullptr;
}

void analyzeDefinition(const Definition& instance,
                       const Definition& sourceDefinition,
                       FlowEvaluator& evaluator, OriginRegistry& origins,
                       FlowRecorder& recorder) {
  if (!instance.body) return;
  const FlowStream input = makeParameterStream(instance, sourceDefinition, origins);
  if (sourceDefinition.hasSignature) {
    markPort(sourceDefinition.domain, instance.in, input, recorder);
  } else if (!input.empty()) {
    recorder.mark(sourceDefinition.position, allSources(input));
  }

  evaluator.beginDefinition(&instance);
  const FlowStream output = evaluator.evaluate(*instance.body, input, true);
  evaluator.endDefinition();
  if (sourceDefinition.hasSignature) {
    markPort(sourceDefinition.codomain, instance.out, output, recorder);
  }
}

}  // namespace

Provenance analyzeProvenance(const Program& program,
                             const std::vector<Token>& tokens) {
  OriginRegistry origins;
  FlowRecorder recorder(tokens);
  FlowEvaluator evaluator(program, origins, recorder);

  for (const Definition& definition : program.definitions) {
    if (definition.templateParameters.empty()) {
      analyzeDefinition(definition, definition, evaluator, origins, recorder);
    }
  }

  for (const Definition& instance : program.specializations) {
    if (const Definition* source = templateSource(program, instance)) {
      analyzeDefinition(instance, *source, evaluator, origins, recorder);
    }
  }

  if (program.main) {
    const FlowStream input = mainInput(*program.main, origins);
    evaluator.evaluate(*program.main, input, true);
  }

  return {origins.values(), recorder.values()};
}

}  // namespace qwq::web
