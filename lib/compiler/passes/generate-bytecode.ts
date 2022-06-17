import { Action, Alternative, bytecodeDone, CharacterClass, Element, MatchResult, Primary, SemanticPredicate, Suffixed, Visitor } from "../../parser";
import { indexOfRule } from "../asts";
import { Bytecode, opcodes as op } from "../opcodes";
import { buildExprVisitor, buildVisitor } from "../visitor";
import type { Pass } from './pass';
// Generates bytecode.
//
// Instructions
// ============
//
// Stack Manipulation
// ------------------
//
//  [35] PUSH_EMPTY_STRING
//
//        stack.push("");
//
//  [1] PUSH_UNDEFINED
//
//        stack.push(undefined);
//
//  [2] PUSH_NULL
//
//        stack.push(null);
//
//  [3] PUSH_FAILED
//
//        stack.push(FAILED);
//
//  [4] PUSH_EMPTY_ARRAY
//
//        stack.push([]);
//
//  [5] PUSH_CURR_POS
//
//        stack.push(currPos);
//
//  [6] POP
//
//        stack.pop();
//
//  [7] POP_CURR_POS
//
//        currPos = stack.pop();
//
//  [8] POP_N n
//
//        stack.pop(n);
//
//  [9] NIP
//
//        value = stack.pop();
//        stack.pop();
//        stack.push(value);
//
// [10] APPEND
//
//        value = stack.pop();
//        array = stack.pop();
//        array.push(value);
//        stack.push(array);
//
// [11] WRAP n
//
//        stack.push(stack.pop(n));
//
// [12] TEXT
//
//        stack.push(input.substring(stack.pop(), currPos));
//
// [36] PLUCK n, k, p1, ..., pK
//
//        value = [stack[p1], ..., stack[pK]]; // when k != 1
//        -or-
//        value = stack[p1];                   // when k == 1
//
//        stack.pop(n);
//        stack.push(value);
//
// Conditions and Loops
// --------------------
//
// [13] IF t, f
//
//        if (stack.top()) {
//          interpret(ip + 3, ip + 3 + t);
//        } else {
//          interpret(ip + 3 + t, ip + 3 + t + f);
//        }
//
// [14] IF_ERROR t, f
//
//        if (stack.top() === FAILED) {
//          interpret(ip + 3, ip + 3 + t);
//        } else {
//          interpret(ip + 3 + t, ip + 3 + t + f);
//        }
//
// [15] IF_NOT_ERROR t, f
//
//        if (stack.top() !== FAILED) {
//          interpret(ip + 3, ip + 3 + t);
//        } else {
//          interpret(ip + 3 + t, ip + 3 + t + f);
//        }
//
// [16] WHILE_NOT_ERROR b
//
//        while(stack.top() !== FAILED) {
//          interpret(ip + 2, ip + 2 + b);
//        }
//
// Matching
// --------
//
// [17] MATCH_ANY a, f, ...
//
//        if (input.length > currPos) {
//          interpret(ip + 3, ip + 3 + a);
//        } else {
//          interpret(ip + 3 + a, ip + 3 + a + f);
//        }
//
// [18] MATCH_STRING s, a, f, ...
//
//        if (input.substr(currPos, literals[s].length) === literals[s]) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
// [19] MATCH_STRING_IC s, a, f, ...
//
//        if (input.substr(currPos, literals[s].length).toLowerCase() === literals[s]) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
// [20] MATCH_CHAR_CLASS c, a, f, ...
//
//        if (classes[c].test(input.charAt(currPos))) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
// [21] ACCEPT_N n
//
//        stack.push(input.substring(currPos, n));
//        currPos += n;
//
// [22] ACCEPT_STRING s
//
//        stack.push(literals[s]);
//        currPos += literals[s].length;
//
// [23] FAIL e
//
//        stack.push(FAILED);
//        fail(expectations[e]);
//
// Calls
// -----
//
// [24] LOAD_SAVED_POS p
//
//        savedPos = stack[p];
//
// [25] UPDATE_SAVED_POS
//
//        savedPos = currPos;
//
// [26] CALL f, n, pc, p1, p2, ..., pN
//
//        value = functions[f](stack[p1], ..., stack[pN]);
//        stack.pop(n);
//        stack.push(value);
//
// Rules
// -----
//
// [27] RULE r
//
//        stack.push(parseRule(r));
//
// Failure Reporting
// -----------------
//
// [28] SILENT_FAILS_ON
//
//        silentFails++;
//
// [29] SILENT_FAILS_OFF
//
//        silentFails--;
//
// This pass can use the results of other previous passes, each of which can
// change the AST (and, as consequence, the bytecode).
//
// In particular, if the pass |inferenceMatchResult| has been run before this pass,
// then each AST node will contain a |match| property, which represents a possible
// match result of the node:
// - `<0` - node is never matched, for example, `!('a'*)` (negation of the always
//          matched node). Generator can put |FAILED| to the stack immediately
// - `=0` - sometimes node matched, sometimes not. This is the same behavior
//          when |match| is missed
// - `>0` - node is always matched, for example, `'a'*` (because result is an
//          empty array, or an array with some elements). The generator does not
//          need to add a check for |FAILED|, because it is impossible
//
// To handle the situation, when the |inferenceMatchResult| has not run (that
// happens, for example, in tests), the |match| value extracted using the
// `|0` trick, which performing cast of any value to an integer with value `0`
// that is equivalent of an unknown match result and signals the generator that
// runtime check for the |FAILED| is required. Trick is explained on the
// Wikipedia page (https://en.wikipedia.org/wiki/Asm.js#Code_generation)

interface Context {
  // Stack pointer
  sp: number;
  // Mapping of label names to stack positions
  env: Record<string, number>;
  // Fields that have been picked
  pluck?: number[];
  // Action nodes pass themselves to children here
  action: Action | null;
}

export const generateBytecode: Pass = (ast) => {
  const literals: string[] = [];
  const classes: bytecodeDone.CharClassDesc[] = [];
  const expectations: bytecodeDone.ExpectedConst[] = [];
  const functions: bytecodeDone.FunctionDesc[] = [];

  const addLiteralConst = (value: string): number => {
    const index = literals.indexOf(value);

    return index === -1 ? literals.push(value) - 1 : index;
  };

  const addClassConst = (node: CharacterClass): number => {
    const cls: bytecodeDone.CharClassDesc = {
      value: node.parts,
      inverted: node.inverted,
      ignoreCase: node.ignoreCase,
    };
    const pattern = JSON.stringify(cls);
    const index = classes.findIndex(c => JSON.stringify(c) === pattern);

    return index === -1 ? classes.push(cls) - 1 : index;
  };

  const addExpectedConst = (expected: bytecodeDone.ExpectedConst): number => {
    const pattern = JSON.stringify(expected);
    const index = expectations.findIndex(e => JSON.stringify(e) === pattern);

    return index === -1 ? expectations.push(expected) - 1 : index;
  };

  const addFunctionConst = (predicate: boolean, params: string[], node: Action | SemanticPredicate): number => {
    const func: bytecodeDone.FunctionDesc = {
      predicate,
      params,
      body: node.code,
      location: node.codeLocation,
    };
    const pattern = JSON.stringify(func);
    const index = functions.findIndex(f => JSON.stringify(f) === pattern);

    return index === -1 ? functions.push(func) - 1 : index;
  }

  const buildSequence = (first: Bytecode, ...args: Bytecode[]) => first.concat(...args);

  const buildCondition = (match: MatchResult, condCode: Bytecode, thenCode: Bytecode, elseCode: Bytecode) => {
    if (match === MatchResult.ALWAYS) { return thenCode; }
    if (match === MatchResult.NEVER)  { return elseCode; }

    return condCode.concat(
      [thenCode.length, elseCode.length],
      thenCode,
      elseCode
    );
  }

  const buildLoop = (condCode: Bytecode, bodyCode: Bytecode): Bytecode => condCode.concat([bodyCode.length], bodyCode);

  const buildCall = (functionIndex: number, delta: number, env: Record<string, number>, sp: number): Bytecode => {
    const params = Object.keys(env).map(name => sp - env[name]);

    return [op.CALL, functionIndex, delta, params.length].concat(params);
  }

  const buildSimplePredicate = (expression: Suffixed | Primary, negative: boolean, context: Context): Bytecode => {
    const match = expression.match || MatchResult.SOMETIMES;

    return buildSequence(
      [op.PUSH_CURR_POS],
      [op.SILENT_FAILS_ON],
      generate(expression, {
        sp: context.sp + 1,
        env: {...context.env},
        action: null,
      }),
      [op.SILENT_FAILS_OFF],
      buildCondition(
        negative ? -match : match,
        [negative ? op.IF_ERROR : op.IF_NOT_ERROR],
        buildSequence(
          [op.POP],
          [negative ? op.POP : op.POP_CURR_POS],
          [op.PUSH_UNDEFINED]
        ),
        buildSequence(
          [op.POP],
          [negative ? op.POP_CURR_POS : op.POP],
          [op.PUSH_FAILED]
        )
      )
    );
  }

  const buildSemanticPredicate = (node: SemanticPredicate, negative: boolean, context: Context): Bytecode => {
    const functionIndex = addFunctionConst(
      true, Object.keys(context.env), node
    );

    return buildSequence(
      [op.UPDATE_SAVED_POS],
      buildCall(functionIndex, 0, context.env, context.sp),
      buildCondition(
        node.match || MatchResult.SOMETIMES,
        [op.IF],
        buildSequence(
          [op.POP],
          negative ? [op.PUSH_FAILED] : [op.PUSH_UNDEFINED]
        ),
        buildSequence(
          [op.POP],
          negative ? [op.PUSH_UNDEFINED] : [op.PUSH_FAILED]
        )
      )
    );
  }

  const buildAppendLoop = (expressionCode: Bytecode) => buildLoop(
    [op.WHILE_NOT_ERROR],
    buildSequence([op.APPEND], expressionCode)
  );

  const generate: Visitor<[Context | null], Bytecode> = buildExprVisitor<[Context | null], Bytecode>({
    grammar(node) {
      node.rules.forEach(rule => generate(rule, null));

      node.literals = literals;
      node.classes = classes;
      node.expectations = expectations;
      node.functions = functions;
      return [];
    },

    top_level_initializer: () => [],
    initializer: () => [],

    rule(node) {
      node.bytecode = generate(node.expression, {
        sp: -1,
        env: {},
        pluck: [],
        action: null,
      });

      return [];
    },

    named(node, context) {
      const match = node.match || MatchResult.SOMETIMES;
      // Expectation not required if node always fail
      const nameIndex = (match === MatchResult.NEVER)
        ? null
        : addExpectedConst({ type: "rule", value: node.name });

      // The code generated below is slightly suboptimal because |FAIL| pushes
      // to the stack, so we need to stick a |POP| in front of it. We lack a
      // dedicated instruction that would just report the failure and not touch
      // the stack.
      return buildSequence(
        [op.SILENT_FAILS_ON],
        generate(node.expression, context),
        [op.SILENT_FAILS_OFF],
        buildCondition(match, [op.IF_ERROR], [op.FAIL, nameIndex], [])
      );
    },

    choice(node, context) {
      const buildAlternativesCode = (alternatives: Alternative[], context: Context): Bytecode => {
        const match = alternatives[0].match || MatchResult.SOMETIMES;
        const first = generate(alternatives[0], {
          sp: context.sp,
          env: {...context.env},
          action: null,
        });
        // If an alternative always match, no need to generate code for the next
        // alternatives. Because their will never tried to match, any side-effects
        // from next alternatives is impossible so we can skip their generation
        if (match === MatchResult.ALWAYS) {
          return first;
        }

        // Even if an alternative never match it can have side-effects from
        // a semantic predicates or an actions, so we can not skip generation
        // of the first alternative.
        // We can do that when analysis for possible side-effects will be introduced
        return buildSequence(
          first,
          alternatives.length > 1
            ? buildCondition(
              MatchResult.SOMETIMES,
              [op.IF_ERROR],
              buildSequence(
                [op.POP],
                buildAlternativesCode(alternatives.slice(1), context)
              ),
              []
            )
            : []
        );
      }

      if (!context) {
        throw new Error('Impossible');
      }

      return buildAlternativesCode(node.alternatives, context);
    },

    action(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      const env = {...context.env};
      const emitCall = node.expression.type !== "sequence"
                    || node.expression.elements.length === 0;
      const expressionCode = generate(node.expression, {
        sp: context.sp + (emitCall ? 1 : 0),
        env,
        action: node,
      });
      const match = node.expression.match || MatchResult.SOMETIMES;
      // Function only required if expression can match
      const functionIndex = emitCall && match !== MatchResult.NEVER
        ? addFunctionConst(false, Object.keys(env), node)
        : null;

      return emitCall
        ? buildSequence(
          [op.PUSH_CURR_POS],
          expressionCode,
          buildCondition(
            match,
            [op.IF_NOT_ERROR],
            buildSequence(
              [op.LOAD_SAVED_POS, 1],
              buildCall(functionIndex, 1, env, context.sp + 2)
            ),
            []
          ),
          [op.NIP]
        )
        : expressionCode;
    },

    sequence(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      const buildElementsCode = (elements: Element[], context: Context): Bytecode => {
        if (elements.length > 0) {
          const processedCount = node.elements.length - elements.length + 1;

          return buildSequence(
            generate(elements[0], {
              sp: context.sp,
              env: context.env,
              pluck: context.pluck,
              action: null,
            }),
            buildCondition(
              elements[0].match || MatchResult.SOMETIMES,
              [op.IF_NOT_ERROR],
              buildElementsCode(elements.slice(1), {
                sp: context.sp + 1,
                env: context.env,
                pluck: context.pluck,
                action: context.action,
              }),
              buildSequence(
                processedCount > 1 ? [op.POP_N, processedCount] : [op.POP],
                [op.POP_CURR_POS],
                [op.PUSH_FAILED]
              )
            )
          );
        } else {
          if (context.pluck && context.pluck.length > 0) {
            return buildSequence(
              [op.PLUCK, node.elements.length + 1, context.pluck.length],
              context.pluck.map(eSP => context.sp - eSP)
            );
          }

          if (context.action) {
            const functionIndex = addFunctionConst(
              false,
              Object.keys(context.env),
              context.action
            );

            return buildSequence(
              [op.LOAD_SAVED_POS, node.elements.length],
              buildCall(
                functionIndex,
                node.elements.length + 1,
                context.env,
                context.sp
              )
            );
          } else {
            return buildSequence([op.WRAP, node.elements.length], [op.NIP]);
          }
        }
      }

      return buildSequence(
        [op.PUSH_CURR_POS],
        buildElementsCode(node.elements, {
          sp: context.sp + 1,
          env: context.env,
          pluck: [],
          action: context.action,
        })
      );
    },

    labeled(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      let env = context.env;
      const label = node.label;
      const sp = context.sp + 1;

      if (label) {
        env = {...context.env};
        context.env[label] = sp;
      }

      if (node.pick) {
        if (!context.pluck) {
          throw new Error('Impossible');
        }
        context.pluck.push(sp);
      }

      return generate(node.expression, {
        sp: context.sp,
        env,
        action: null,
      });
    },

    text(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      return buildSequence(
        [op.PUSH_CURR_POS],
        generate(node.expression, {
          sp: context.sp + 1,
          env: {...context.env},
          action: null,
        }),
        buildCondition(
          node.match || MatchResult.SOMETIMES,
          [op.IF_NOT_ERROR],
          buildSequence([op.POP], [op.TEXT]),
          [op.NIP]
        )
      );
    },

    simple_and(node, context) {
      return buildSimplePredicate(node.expression, false, context);
    },

    simple_not(node, context) {
      return buildSimplePredicate(node.expression, true, context);
    },

    optional(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      return buildSequence(
        generate(node.expression, {
          sp: context.sp,
          env: {...context.env},
          action: null,
        }),
        buildCondition(
          // Check expression match, not the node match
          // If expression always match, no need to replace FAILED to NULL,
          // because FAILED will never appeared
          -(node.expression.match || MatchResult.SOMETIMES),
          [op.IF_ERROR],
          buildSequence([op.POP], [op.PUSH_NULL]),
          []
        )
      );
    },

    zero_or_more(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      const expressionCode = generate(node.expression, {
        sp: context.sp + 1,
        env: {...context.env},
        action: null,
      });

      return buildSequence(
        [op.PUSH_EMPTY_ARRAY],
        expressionCode,
        buildAppendLoop(expressionCode),
        [op.POP]
      );
    },

    one_or_more(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      const expressionCode = generate(node.expression, {
        sp: context.sp + 1,
        env: {...context.env},
        action: null,
      });

      return buildSequence(
        [op.PUSH_EMPTY_ARRAY],
        expressionCode,
        buildCondition(
          // Condition depends on the expression match, not the node match
          node.expression.match || MatchResult.SOMETIMES,
          [op.IF_NOT_ERROR],
          buildSequence(buildAppendLoop(expressionCode), [op.POP]),
          buildSequence([op.POP], [op.POP], [op.PUSH_FAILED])
        )
      );
    },

    group(node, context) {
      if (!context) {
        throw new Error('Impossible');
      }

      return generate(node.expression, {
        sp: context.sp,
        env: {...context.env},
        action: null,
      });
    },

    semantic_and(node, context) {
      return buildSemanticPredicate(node, false, context);
    },

    semantic_not(node, context) {
      return buildSemanticPredicate(node, true, context);
    },

    rule_ref(node) {
      return [op.RULE, indexOfRule(ast, node.name)];
    },

    literal(node) {
      if (node.value.length > 0) {
        const match = node.match || MatchResult.SOMETIMES;
        // String only required if condition is generated or string is
        // case-sensitive and node always match
        const needConst = match === MatchResult.SOMETIMES
                      || (match === MatchResult.ALWAYS && !node.ignoreCase);
        const stringIndex = needConst
          ? addLiteralConst(
            node.ignoreCase ? node.value.toLowerCase() : node.value
          )
          : null;
        // Expectation not required if node always match
        const expectedIndex = (match !== MatchResult.ALWAYS)
          ? addExpectedConst({
            type: "literal",
            value: node.value,
            ignoreCase: node.ignoreCase,
          })
          : null;

        // For case-sensitive strings the value must match the beginning of the
        // remaining input exactly. As a result, we can use |ACCEPT_STRING| and
        // save one |substr| call that would be needed if we used |ACCEPT_N|.
        return buildCondition(
          match,
          node.ignoreCase
            ? [op.MATCH_STRING_IC, stringIndex]
            : [op.MATCH_STRING, stringIndex],
          node.ignoreCase
            ? [op.ACCEPT_N, node.value.length]
            : [op.ACCEPT_STRING, stringIndex],
          [op.FAIL, expectedIndex]
        );
      }

      return [op.PUSH_EMPTY_STRING];
    },

    class(node) {
      const match = node.match || MatchResult.SOMETIMES;
      // Character class constant only required if condition is generated
      const classIndex = match === MatchResult.SOMETIMES ? addClassConst(node) : null;
      // Expectation not required if node always match
      const expectedIndex = (match !== MatchResult.ALWAYS)
        ? addExpectedConst({
          type: "class",
          value: node.parts,
          inverted: node.inverted,
          ignoreCase: node.ignoreCase,
        })
        : null;

      return buildCondition(
        match,
        [op.MATCH_CHAR_CLASS, classIndex],
        [op.ACCEPT_N, 1],
        [op.FAIL, expectedIndex]
      );
    },

    any(node) {
      const match = node.match || MatchResult.SOMETIMES;
      // Expectation not required if node always match
      const expectedIndex = (match !== MatchResult.ALWAYS)
        ? addExpectedConst({
          type: "any",
        })
        : null;

      return buildCondition(
        match,
        [op.MATCH_ANY],
        [op.ACCEPT_N, 1],
        [op.FAIL, expectedIndex]
      );
    },
  });

  generate(ast, null);
}
