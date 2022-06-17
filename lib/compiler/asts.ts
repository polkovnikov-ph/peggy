import { buildExprVisitor } from "./visitor";
import type { AnyNode, Grammar } from "../parser";

export const findRule = (ast: Grammar, name: string) => {
  for (let i = 0; i < ast.rules.length; i++) {
    if (ast.rules[i].name === name) {
      return ast.rules[i];
    }
  }

  return undefined;
};

export const indexOfRule = (ast: Grammar, name: string) => {
  for (let i = 0; i < ast.rules.length; i++) {
    if (ast.rules[i].name === name) {
      return i;
    }
  }

  // istanbul ignore next Presence of rules checked using another approach that not involve this function
  // Any time when it is called the rules always exist
  return -1;
};

export const alwaysConsumesOnSuccess = (ast: Grammar, node: AnyNode): boolean => {
  const neverHappens = () => { throw new Error('Impossible') };
  const consumesTrue = () => true;
  const consumesFalse = () => false;

  const consumes: (node: AnyNode) => boolean = buildExprVisitor({
    grammar: neverHappens,
    top_level_initializer: neverHappens,
    initializer: neverHappens,
    choice: node => node.alternatives.every(consumes),
    sequence: node => node.elements.some(consumes),
    simple_and: consumesFalse,
    simple_not: consumesFalse,
    optional: consumesFalse,
    zero_or_more: consumesFalse,
    semantic_and: consumesFalse,
    semantic_not: consumesFalse,
    rule_ref: node => {
      const rule = findRule(ast, node.name);

      // Because we run all checks in one stage, some rules could be missing.
      // Checking for missing rules could be executed in parallel to this check
      return rule ? consumes(rule) : false;
    },
    literal: node => node.value !== "",
    class: consumesTrue,
    any: consumesTrue,
  });

  return consumes(node);
};
