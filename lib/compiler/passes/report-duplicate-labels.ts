import type { Expressions, LocationRange, Visitor } from "../../parser";
import { buildVisitor } from "../visitor";
import type { Pass } from "./pass";

type Env = Record<string, LocationRange>;

// Checks that each label is defined only once within each scope.
export const reportDuplicateLabels: Pass = (ast, options, session) => {
  const checkExpressionWithClonedEnv = (
    node: Expressions[keyof Expressions],
    env: Env,
  ) => check(node.expression, {...env});

  const check: Visitor<[Env], void> = buildVisitor({
    rule: node => check(node.expression, { }),

    choice: ({alternatives}, env) => {
      for (const alternative of alternatives) {
        check(alternative, {...env});
      }
    },

    action: checkExpressionWithClonedEnv,

    labeled({label, labelLocation, expression}, env) {
      if (label && Object.prototype.hasOwnProperty.call(env, label)) {
        session.error(
          `Label "${label}" is already defined`,
          labelLocation,
          [{
            message: "Original label location",
            location: env[label],
          }]
        );
      }

      check(expression, env);

      if (label) {
        env[label] = labelLocation;
      }
    },

    text: checkExpressionWithClonedEnv,
    simple_and: checkExpressionWithClonedEnv,
    simple_not: checkExpressionWithClonedEnv,
    optional: checkExpressionWithClonedEnv,
    zero_or_more: checkExpressionWithClonedEnv,
    one_or_more: checkExpressionWithClonedEnv,
    group: checkExpressionWithClonedEnv,
  });

  check(ast, {});
}
