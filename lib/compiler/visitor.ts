import type * as a from '../parser';

type ExprNodeType = 'rule'  | 'named'  | 'action'  | 'labeled'  | 'text'  | 'simple_and'  | 'simple_not'  | 'optional'  | 'zero_or_more'  | 'one_or_more'  | 'group' 
type ExprFunctions<T extends any[], U> = Pick<a.VisitorFunctions<T, U>, ExprNodeType>
type OtherFunctions<T extends any[], U> = Omit<a.VisitorFunctions<T, U>, ExprNodeType>

export const buildExprVisitor = <T extends any[], U>(functions: Partial<ExprFunctions<T, U>> & OtherFunctions<T, U>): a.Visitor<T, U> => {
  const visitExpression = <K extends keyof a.Expressions>({expression}: a.Expressions[K], ...args: T) => visit(expression, ...args);
  const mergedFunctions = {
    rule: visitExpression,
    named: visitExpression,
    action: visitExpression,
    labeled: visitExpression,
    text: visitExpression,
    simple_and: visitExpression,
    simple_not: visitExpression,
    optional: visitExpression,
    zero_or_more: visitExpression,
    one_or_more: visitExpression,
    group: visitExpression,
    ...functions,
  };

  // NB: everything is fine with the type, but TypeScript complains that "union type is too complex". well, it is.
  const visit: a.Visitor<T, U> = (node, ...args) => (mergedFunctions[node.type] as any)(node, ...args);

  return visit;
};

export const buildVisitor = <T extends any[]>(functions: Partial<a.VisitorFunctions<T, void>>): a.Visitor<T, void> => {
  const visitGrammar = (node: a.Grammar, ...args: T) => {
    if (node.topLevelInitializer) {
      visit(node.topLevelInitializer, ...args);
    }
    if (node.initializer) {
      visit(node.initializer, ...args);
    }
    for (const rule of node.rules) {
      visit(rule, ...args)
    }
  };

  const visitNop = () => {};

  // We do not use .map() here, because if you need the result
  // of applying visitor to children you probably also need to
  // process it in some way, therefore you anyway have to override
  // this method. If you do not needed that, we do not waste time
  // and memory for creating the output array
  const visitChoice = ({alternatives}: a.Choice, ...args: T) => {
    for (const child of alternatives) {
      visit(child, ...args)
    }
  };
  const visitSequence = ({elements}: a.Sequence, ...args: T) => {
    for (const child of elements) {
      visit(child, ...args)
    }
  };

  const visit = buildExprVisitor<T, void>({
    grammar: visitGrammar,
    top_level_initializer: visitNop,
    initializer: visitNop,
    choice: visitChoice,
    sequence: visitSequence,
    semantic_and: visitNop,
    semantic_not: visitNop,
    rule_ref: visitNop,
    literal: visitNop,
    class: visitNop,
    any: visitNop,
    ...functions,
  });

  return visit;
};