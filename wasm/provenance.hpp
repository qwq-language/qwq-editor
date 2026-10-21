#pragma once

#include <cstddef>
#include <string>
#include <vector>

#include "ast.hpp"
#include "lexer.hpp"

namespace qwq::web {

struct FlowOrigin {
  std::string id;
  std::size_t anchor = 0;
};

struct FlowSignature {
  std::string text;
  bool hasDeclaration = false;
  std::size_t declaration = 0;

  bool operator==(const FlowSignature&) const = default;
};

struct FlowMark {
  std::size_t start = 0;
  std::size_t end = 0;
  std::vector<std::string> origins;
  bool color = true;  ///< false keeps provenance for hover without tinting syntax
  std::vector<FlowSignature> signatures;
};

struct Provenance {
  std::vector<FlowOrigin> origins;
  std::vector<FlowMark> marks;
};

/// Compute single-origin value flow and resolved signatures for checked
/// expressions. Positions and ranges are UTF-8 byte offsets, like lexer tokens.
Provenance analyzeProvenance(const Program& program,
                             const std::vector<Token>& tokens);

}  // namespace qwq::web
