import { buildExprVisitor, buildVisitor } from "../visitor";
import { findRule } from "../asts";
import { GrammarError } from "../../grammar-error";
import type { Pass } from "./pass";
import * as a from "../../parser";
import { MatchResult } from "../../parser";

// Inference match result of the each node. Can be:
// -1: negative result, matching of that node always fails
//  0: neutral result, may be fail, may be match
//  1: positive result, always match
export const inferenceMatchResult: Pass = (ast) => {
  const sometimesMatch = (
    node: Exclude<a.AnyNode, a.Grammar | a.TopLevelInitializer | a.Initializer>
  ) => (node.match = MatchResult.SOMETIMES);
  const alwaysMatch = (node: a.Expressions[keyof a.Expressions]) => {
    inference(node.expression);

    return (node.match = MatchResult.ALWAYS);
  }
  const inferenceExpression = (node: a.Expressions[keyof a.Expressions]) => (node.match = inference(node.expression));
  const inferenceElements = (elements: (a.Alternative | a.Element)[], forChoice: boolean) => {
    const length = elements.length;
    let always = 0;
    let never = 0;

    for (let i = 0; i < length; ++i) {
      const result = inference(elements[i]);

      if (result === MatchResult.ALWAYS) { ++always; }
      if (result === MatchResult.NEVER)  { ++never;  }
    }

    if (always === length) {
      return MatchResult.ALWAYS;
    }
    if (forChoice) {
      return never === length ? MatchResult.NEVER : MatchResult.SOMETIMES;
    }

    return never > 0 ? MatchResult.NEVER : MatchResult.SOMETIMES;
  }

  const ignoreNode = () => MatchResult.NEVER;

  const inference: a.Visitor<[], MatchResult> = buildExprVisitor({
    grammar: ignoreNode,
    initializer: ignoreNode,
    top_level_initializer: ignoreNode,
    rule(node) {
      let oldResult;
      let count = 0;

      // If property not yet calculated, do that
      if (typeof node.match === "undefined") {
        node.match = MatchResult.SOMETIMES;
        do {
          oldResult = node.match;
          node.match = inference(node.expression);
          // 6 == 3! -- permutations count for all transitions from one match
          // state to another.
          // After 6 iterations the cycle with guarantee begins
          // For example, an input of `start = [] start` will generate the
          // sequence: 0 -> -1 -> -1 (then stop)
          //
          // A more complex grammar theoretically would generate the
          // sequence: 0 -> 1 -> 0 -> -1 -> 0 -> 1 -> ... (then cycle)
          // but there are no examples of such grammars yet (possible, they
          // do not exist at all)

          // istanbul ignore next  This is canary test, shouldn't trigger in real life
          if (++count > 6) {
            throw new GrammarError(
              "Infinity cycle detected when trying to evaluate node match result",
              node.location
            );
          }
        } while (oldResult !== node.match);
      }

      return node.match;
    },
    named:        inferenceExpression,
    choice(node) {
      return (node.match = inferenceElements(node.alternatives, true));
    },
    action:       inferenceExpression,
    sequence(node) {
      return (node.match = inferenceElements(node.elements, false));
    },
    labeled:      inferenceExpression,
    text:         inferenceExpression,
    simple_and:   inferenceExpression,
    simple_not(node) {
      return (node.match = -inference(node.expression));
    },
    optional:     alwaysMatch,
    zero_or_more: alwaysMatch,
    one_or_more:  inferenceExpression,
    group:        inferenceExpression,
    semantic_and: sometimesMatch,
    semantic_not: sometimesMatch,
    rule_ref(node) {
      const rule = findRule(ast, node.name);

      if (rule) {
        return (node.match = inference(rule));
      } else {
        return MatchResult.SOMETIMES;
      }
    },
    literal(node) {
      // Empty literal always match on any input
      const match = node.value.length === 0 ? MatchResult.ALWAYS : MatchResult.SOMETIMES;

      return (node.match = match);
    },
    class(node) {
      // Empty character class never match on any input
      const match = node.parts.length === 0 ? MatchResult.NEVER : MatchResult.SOMETIMES;

      return (node.match = match);
    },
    // |any| not match on empty input
    any:          sometimesMatch,
  });

  inference(ast);
}