import * as peggy from "../lib/peg";
import {
  Command,
  CommanderError,
  type ErrorOptions,
  HelpConfiguration,
  InvalidArgumentError,
  Option,
  OutputConfiguration,
} from "commander";
import { Module } from "module";
import { Readable } from "stream";
import { entries } from "../lib/compiler/utils";
import fs from "fs";
import path from "path";
import util from "util";
import vm from "vm";

export {
  CommanderError,
  InvalidArgumentError,
};

interface Stdio {
  in: NodeJS.ReadStream;
  out: NodeJS.WriteStream;
  err: NodeJS.WriteStream;
}

interface ProgOptions {
  ast: unknown;
  input: string;
  output: string;
  sourceMap: "hidden:inline" | true | "source.map" | string;
  startRule: string;
  test: unknown;
  testFile: string;
  verbose: unknown;
}

interface BuildOptionsBase extends ProgOptions {
  allowedStartRules: string[];
  plugin: string[];
  plugins: string[];
  dependencies: unknown;
  dependency: string[];
  format: string;
  exportVar: unknown;
  info: unknown;
  warning: unknown;
  grammarSource: unknown;
}

interface ErrorOpts extends ErrorOptions {
  code: string;
  exitCode: number;
  error: Error;
  sources: {
    source: unknown;
    text: string;
  }[];
}

// Options that aren't for the API directly:
const PROG_OPTIONS: (keyof BuildOptionsBase)[] = [
  "ast", "input", "output", "sourceMap", "startRule", "test", "testFile", "verbose",
];
const MODULE_FORMATS = ["amd", "bare", "commonjs", "es", "globals", "umd"];
const MODULE_FORMATS_WITH_DEPS = ["amd", "commonjs", "es", "umd"];
const MODULE_FORMATS_WITH_GLOBAL = ["globals", "umd"];

// Helpers

const select = <T, K extends keyof T>(obj: T, sel: K[]): Pick<T, K> => {
  const ret = {} as Pick<T, K>;
  for (const s of sel) {
    if (Object.prototype.hasOwnProperty.call(obj, s)) {
      ret[s] = obj[s];
      delete obj[s];
    }
  }
  return ret;
};

const commaArg = (val: string, prev: string[] = []) => prev.concat(val.split(",").map(x => x.trim()));

// Files

const readStream = (inputStream: Readable) => (
  new Promise<string>((resolve, reject) => {
    const input: Buffer[] = [];
    inputStream.on("data", data => input.push(data));
    inputStream.on("end", () => resolve(Buffer.concat(input).toString()));
    inputStream.on("error", reject);
  })
);

const readFile = (name: string) => {
  try {
    return fs.readFileSync(name, "utf8");
  } catch (e) {
    throw new InvalidArgumentError(`Can't read from file "${name}".`, e);
  }
};

// Command line processing
export class PeggyCLI extends Command {
  private std: Stdio;

  private colors: boolean;

  private argv: BuildOptionsBase;

  private inputFile: string | null = null;

  private outputFile: string | null = null;

  private progOptions: ProgOptions;

  private testFile: string | null = null;

  private testGrammarSource: string | null = null;

  private testText: string | null = null;

  private outputJS: string | null = null;

  /**
   * Create a CLI environment.
   *
   * @param stdio Replacement streams for stdio, for testing.
   */
  constructor(stdio: Partial<Stdio> = {}) {
    super("peggy");

    /** @type {Stdio} */
    this.std = {
      in: process.stdin,
      out: process.stdout,
      err: process.stderr,
      ...stdio,
    };
    this.colors = this.std.err.isTTY;

    this
      .version(peggy.VERSION, "-v, --version")
      .argument("[input_file]", 'Grammar file to read.  Use "-" to read stdin.', "-")
      .allowExcessArguments(false)
      .addOption(
        new Option(
          "--allowed-start-rules <rules>",
          "Comma-separated list of rules the generated parser will be allowed to start parsing from.  (Can be specified multiple times)"
        )
          .default([], "the first rule in the grammar")
          .argParser(commaArg)
      )
      .option(
        "--cache",
        "Make generated parser cache results",
        false
      )
      .option(
        "-d, --dependency <dependency>",
        "Comma-separated list of dependencies, either as a module name, or as `variable:module`. (Can be specified multiple times)",
        commaArg
      )
      .option(
        "-D, --dependencies <json>",
        "Dependencies, in JSON object format with variable:module pairs. (Can be specified multiple times).",
        (val, prev = {}) => {
          let v = null;
          try {
            v = JSON.parse(val);
          } catch (e) {
            throw new InvalidArgumentError(`Error parsing JSON: ${e.message}`);
          }
          return Object.assign(prev, v);
        }
      )
      .option(
        "-e, --export-var <variable>",
        "Name of a global variable into which the parser object is assigned to when no module loader is detected."
      )
      .option(
        "--extra-options <options>",
        "Additional options (in JSON format as an object) to pass to peggy.generate",
        val => this.addExtraOptionsJSON(val, "extra-options")
      )
      .option(
        "-c, --extra-options-file <file>",
        "File with additional options (in JSON as an object or commonjs module format) to pass to peggy.generate",
        val => {
          if (/\.c?js$/.test(val)) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            return this.addExtraOptions(require(path.resolve(val)), "extra-options-file");
          } else {
            return this.addExtraOptionsJSON(readFile(val), "extra-options-file");
          }
        }
      )
      .addOption(
        new Option(
          "--format <format>",
          "Format of the generated parser"
        )
          .choices(MODULE_FORMATS)
          .default("commonjs")
      )
      .option("-o, --output <file>", "Output file for generated parser. Use '-' for stdout (the default, unless a test is specified, in which case no parser is output without this option)")
      .option(
        "--plugin <module>",
        "Comma-separated list of plugins. (can be specified multiple times)",
        commaArg
      )
      .option(
        "-m, --source-map [mapfile]",
        "Generate a source map. If name is not specified, the source map will be named \"<input_file>.map\" if input is a file and \"source.map\" if input is a standard input. If the special filename `inline` is given, the sourcemap will be embedded in the output file as a data URI.  If the filename is prefixed with `hidden:`, no mapping URL will be included so that the mapping can be specified with an HTTP SourceMap: header.  This option conflicts with the `-t/--test` and `-T/--test-file` options unless `-o/--output` is also specified"
      )
      .addOption(
        new Option(
          "--ast",
          "Output a grammar AST instead of a parser code"
        )
          .default(false)
          .conflicts(["test", "testFile", "sourceMap"])
      )
      .option(
        "-S, --start-rule <rule>",
        "When testing, use the given rule as the start rule.  If this rule is not in the allowed start rules, it will be added."
      )
      .option(
        "-t, --test <text>",
        "Test the parser with the given text, outputting the result of running the parser instead of the parser itself. If the input to be tested is not parsed, the CLI will exit with code 2"
      )
      .addOption(new Option(
        "-T, --test-file <filename>",
        "Test the parser with the contents of the given file, outputting the result of running the parser instead of the parser itself. If the input to be tested is not parsed, the CLI will exit with code 2"
      ).conflicts("test"))
      .option("--trace", "Enable tracing in generated parser", false)
      .addOption(
        // Not interesting yet.  If it becomes so, unhide the help.
        new Option("--verbose", "Enable verbose logging")
          .hideHelp()
          .default(false)
      )
      .addOption(
        new Option("-O, --optimize <style>")
          .hideHelp()
          .argParser(() => {
            this.print(this.std.err, "Option --optimize is deprecated from 1.2.0 and has no effect anymore.");
            this.print(this.std.err, "It will be deleted in 2.0.");
            this.print(this.std.err, "Parser will be generated in the former \"speed\" mode.");
            return "speed";
          })
      )
      .action((inputFile, opts: BuildOptionsBase) => { // On parse()
        this.inputFile = inputFile;
        this.argv = opts;

        if ((typeof opts.startRule === "string")
          && !opts.allowedStartRules.includes(opts.startRule)) {
          opts.allowedStartRules.push(opts.startRule);
        }

        if (opts.allowedStartRules.length === 0) {
          // [] is an invalid input, as is null
          // undefined doesn't work as a default in commander
          delete opts.allowedStartRules;
        }

        // Combine plugin/plugins
        const allPlugins = [...(opts.plugins || []), ...(opts.plugin || [])];
        if (allPlugins.length > 0) {
          // eslint-disable-next-line consistent-return
          opts.plugins = allPlugins.map(val => {
            if (typeof val !== "string") {
              return val;
            }
            // If this is an absolute or relative path (not a module name)
            const id = (path.isAbsolute(val) || /^\.\.?[/\\]/.test(val))
              ? path.resolve(val)
              : val;
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              return require(id);
            } catch (e) {
              if (e.code !== "MODULE_NOT_FOUND") {
                this.error(`requiring:\n${e.stack}`);
              } else {
                this.error(`requiring "${id}": ${e.message}`);
              }
            }
          });
        }
        delete opts.plugin;

        // Combine dependency/dependencies
        opts.dependencies = opts.dependencies || {};
        if (opts.dependency) {
          if (opts.dependency.length > 0) {
            for (const dep of opts.dependency) {
              const [name, val] = dep.split(":");
              opts.dependencies[name] = val ? val : name;
            }
          }
          delete opts.dependency;
        }

        if ((Object.keys(opts.dependencies).length > 0)
            && (MODULE_FORMATS_WITH_DEPS.indexOf(opts.format) === -1)) {
          this.error(`Can't use the -d/--dependency or -D/--dependencies options with the "${opts.format}" module format.`);
        }

        if ((opts.exportVar !== undefined)
            && (MODULE_FORMATS_WITH_GLOBAL.indexOf(opts.format) === -1)) {
          this.error(`Can't use the -e/--export-var option with the "${opts.format}" module format.`);
        }

        this.progOptions = select(opts, PROG_OPTIONS);
        opts.output = "source";
        if ((this.args.length === 0) && this.progOptions.input) {
          // Allow command line to override config file.
          this.inputFile = this.progOptions.input;
        }
        this.outputFile = this.progOptions.output;
        this.outputJS = this.progOptions.output;

        if (!this.outputFile) {
          if (this.inputFile !== "-") {
            this.outputJS = this.inputFile.substr(
              0,
              this.inputFile.length - path.extname(this.inputFile).length
            ) + ".js";

            this.outputFile = ((typeof this.progOptions.test !== "string")
                               && !this.progOptions.testFile)
              ? this.outputJS
              : "-";
          } else {
            this.outputFile = "-";
            // Synthetic
            this.outputJS = path.join(process.cwd(), "stdout.js");
          }
        }
        // If CLI parameter was defined, enable source map generation
        if (this.progOptions.sourceMap !== undefined) {
          if (!this.progOptions.output
              && (this.progOptions.test || this.progOptions.testFile)) {
            this.error("Generation of the source map is not useful if you don't output a parser file, perhaps you forgot to add an `-o/--output` option?");
          }

          opts.output = "source-and-map";

          // If source map name is not specified, calculate it
          if (this.progOptions.sourceMap === true) {
            this.progOptions.sourceMap = this.outputFile === "-" ? "source.map" : this.outputFile + ".map";
          }

          if (this.progOptions.sourceMap === "hidden:inline") {
            this.error("hidden + inline sourceMap makes no sense.");
          }
        }

        if (this.progOptions.ast) {
          opts.output = "ast";
        }

        // Empty string is a valid test input.  Don't just test for falsy.
        if (typeof this.progOptions.test === "string") {
          this.testText = this.progOptions.test;
          this.testGrammarSource = "command line";
        }
        if (this.progOptions.testFile) {
          this.testFile = this.progOptions.testFile;
          this.testGrammarSource = this.progOptions.testFile;
        }
        this.verbose("PARSER OPTIONS:", opts);
        this.verbose("PROGRAM OPTIONS:", this.progOptions);
        this.verbose('INPUT: "%s"', this.inputFile);
        this.verbose('OUTPUT: "%s"', this.outputFile);
        if (this.progOptions.verbose) {
          opts.info = (pass, msg) => this.print(this.std.err, `INFO(${pass}): ${msg}`);
        }
        opts.warning = (pass, msg) => this.print(this.std.err, `WARN(${pass}): ${msg}`);
      });
  }

  /**
   * Print error message to std.err, and either call process.exit or throw an
   * exception if exitOverride() has been called.  If opts.error is specified,
   * it will be used to generate the error message, rather than using the
   * message provided.
   *
   * @param {string} message The message to print.
   * @param {object} [opts] Options
   * @param {string} [opts.code="peggy.invalidArgument"] Code for exception if
   *   throwing.
   * @param {number} [opts.exitCode=1] Exit code if exiting.
   * @param {peggy.SourceText[]} [opts.sources=[]] Source text for formatting compile errors.
   * @param {Error} [opts.error] Error to extract message from.
   */
  error(message: string, opts: Partial<ErrorOpts> = {}): never {
    const fullOpts: ErrorOpts = {
      code: "peggy.invalidArgument",
      exitCode: 1,
      error: null,
      sources: [],
      ...opts,
    };

    const hasField = <
      T extends object,
      K extends string,
    >(t: T, k: K): t is T & Record<K, any> => k in t;

    if (fullOpts.error) {
      if (
        hasField(fullOpts.error, "format")
        && typeof fullOpts.error.format === "function"
      ) {
        message = `${message}\n${fullOpts.error.format(fullOpts.sources)}`;
      } else {
        message = (this.progOptions.verbose || !fullOpts.error.message)
          ? `${message}\n${fullOpts.error.stack}`
          : `${message}\n${fullOpts.error.message}`;
      }
    }
    if (!/^error/i.test(message)) {
      message = `Error ${message}`;
    }

    super.error(message, opts);
  }

  print(stream, ...args) {
    stream.write(util.formatWithOptions({
      colors: this.colors,
      depth: Infinity,
      maxArrayLength: Infinity,
      maxStringLength: Infinity,
    }, ...args));
    stream.write("\n");
  }

  verbose(...args) {
    if (!this.progOptions.verbose) {
      return false;
    }
    this.print(this.std.err, ...args);
    return true;
  }

  addExtraOptionsJSON(json, source) {
    let extraOptions;

    try {
      extraOptions = JSON.parse(json);
    } catch (e) {
      throw new InvalidArgumentError(`Error parsing JSON: ${e.message}`);
    }

    return this.addExtraOptions(extraOptions, source);
  }

  addExtraOptions(extraOptions, source) {
    if ((extraOptions === null)
        || (typeof extraOptions !== "object")
        || Array.isArray(extraOptions)) {
      throw new InvalidArgumentError("The JSON with extra options has to represent an object.");
    }

    for (const [k, v] of entries(extraOptions)) {
      const prev = this.getOptionValue(k);
      if ((this.getOptionValueSource(k) === "default")
          || (prev === "null")
          || (typeof prev !== "object")) {
        // Overwrite
        this.setOptionValueWithSource(k, v, source);
      } else {
        // Combine with previous if it's a non-default, non-null object.
        if (Array.isArray(prev)) {
          prev.push(...v);
        } else {
          Object.assign(prev, v);
        }
      }
    }
    return null;
  }

  openOutputStream() {
    // If there is a valid outputFile, write the parser to it.  Otherwise,
    // if no test and no outputFile, write to stdout.

    if (this.outputFile === "-") {
      // Note: empty string is a valid input for testText.
      // Don't just test for falsy.
      const hasTest = !this.testFile && (typeof this.testText !== "string");
      return Promise.resolve(hasTest ? this.std.out : null);
    }
    return new Promise((resolve, reject) => {
      const outputStream = fs.createWriteStream(this.outputFile);
      outputStream.on("error", reject);
      outputStream.on("open", () => resolve(outputStream));
    });
  }

  /**
   * Write a source map, and return the serialized plain text.
   *
   * @param {import("source-map-generator").SourceNode} source The SourceNode
   *   to serialize.
   * @returns {Promise<string>} The plain text output.
   */
  writeSourceMap(source) {
    return new Promise((resolve, reject) => {
      if (!this.progOptions.sourceMap) {
        resolve(source);
        return;
      }

      let hidden = false;
      if (
        typeof this.progOptions.sourceMap === "string"
        && this.progOptions.sourceMap.startsWith("hidden:")
      ) {
        hidden = true;
        this.progOptions.sourceMap = this.progOptions.sourceMap.slice(7);
      }
      const inline = this.progOptions.sourceMap === "inline";
      const mapDir = inline
        ? path.dirname(this.outputJS)
        : path.dirname((() => {
          const { sourceMap } = this.progOptions;
          if (typeof sourceMap !== "string") {
            throw new Error("Source map path should be string");
          }
          return sourceMap;
        })());

      const file = path.relative(mapDir, this.outputJS);
      const sourceMap = source.toStringWithSourceMap({ file });

      // According to specifications, paths in the "sources" array should be
      // relative to the map file. Compiler cannot generate right paths, because
      // it is unaware of the source map location
      const json = sourceMap.map.toJSON();
      json.sources = json.sources.map(
        src => (src === null) ? null : path.relative(mapDir, src)
      );

      if (inline) {
        // Note: hidden + inline makes no sense.
        const buf = Buffer.from(JSON.stringify(json));
        // Use \x23 instead of # so that Jest won't treat this as a real
        // source map URL for *this* file.
        resolve(sourceMap.code + `\
//\x23 sourceMappingURL=data:application/json;charset=utf-8;base64,${buf.toString("base64")}
`);
      } else {
        const { sourceMap: sourceMapUrl } = this.progOptions;
        if (typeof sourceMapUrl !== "string") {
          throw new Error("Source map URL should be a string");
        }
        fs.writeFile(
          sourceMap,
          JSON.stringify(json),
          "utf8",
          err => {
            if (err) {
              reject(err);
            } else {
              if (hidden) {
                resolve(sourceMap.code);
              } else {
                // Opposite direction from mapDir
                resolve(sourceMap.code + `\
//# sourceMappingURL=${path.relative(path.dirname(this.outputJS), sourceMapUrl)}
`);
              }
            }
          }
        );
      }
    });
  }

  writeOutput(outputStream, source) {
    return new Promise<void>((resolve, reject) => {
      if (!outputStream) {
        resolve();
        return;
      }
      // Slightly odd formation in order to get test coverage without having to
      // mock the whole file system.
      outputStream.on("error", reject);
      if (outputStream === this.std.out) {
        outputStream.write(source, err => {
          if (!err) {
            resolve();
          }
        });
      } else {
        outputStream.end(source, err => {
          if (!err) {
            resolve();
          }
        });
      }
    });
  }

  test(source) {
    if (this.testFile) {
      this.testText = fs.readFileSync(this.testFile, "utf8");
    }
    if (typeof this.testText === "string") {
      this.verbose("TEST TEXT:", this.testText);

      // Create a module that exports the parser, then load it from the
      // correct directory, so that any modules that the parser requires will
      // be loaded from the correct place.
      const filename = this.outputJS
        ? path.resolve(this.outputJS)
        : path.join(process.cwd(), "stdout.js"); // Synthetic
      const dirname = path.dirname(filename);
      const m = new Module(filename, module);
      // This is the function that will be called by `require()` in the parser.
      m.require = (
        // In node 12+, createRequire is documented.
        // In node 10, createRequireFromPath is the least-undocumented approach.
        Module.createRequire || (Module as any).createRequireFromPath
      )(filename);
      const script = new vm.Script(source, { filename });
      const exec = script.runInNewContext({
        // Anything that is normally in the global scope that we think
        // might be needed.  Limit to what is available in lowest-supported
        // engine version.

        // See: https://github.com/nodejs/node/blob/master/lib/internal/bootstrap/node.js
        // for more things to add.
        module: m,
        exports: m.exports,
        require: m.require,
        __dirname: dirname,
        __filename: filename,

        Buffer,
        TextDecoder: (typeof TextDecoder === "undefined") ? undefined : TextDecoder,
        TextEncoder: (typeof TextEncoder === "undefined") ? undefined : TextEncoder,
        URL,
        URLSearchParams,
        atob: Buffer.atob,
        btoa: Buffer.btoa,
        clearImmediate,
        clearInterval,
        clearTimeout,
        console,
        process,
        setImmediate,
        setInterval,
        setTimeout,
      });

      const opts: {
        grammarSource: string;
        startRule?: string;
      } = {
        grammarSource: this.testGrammarSource,
      };
      if (typeof this.progOptions.startRule === "string") {
        opts.startRule = this.progOptions.startRule;
      }
      const results = exec.parse(this.testText, opts);
      this.print(this.std.out, util.inspect(results, {
        depth: Infinity,
        colors: this.colors,
        maxArrayLength: Infinity,
        maxStringLength: Infinity,
      }));
    }
  }

  async main() {
    let inputStream;

    if (this.inputFile === "-") {
      this.std.in.resume();
      inputStream = this.std.in;
      this.argv.grammarSource = "stdin";
    } else {
      this.argv.grammarSource = this.inputFile;
      inputStream = fs.createReadStream(this.inputFile);
    }

    let exitCode = 1;
    let errorText = "";
    let input = "";
    try {
      this.verbose("CLI", errorText = "reading input stream");
      input = await readStream(inputStream);

      this.verbose("CLI", errorText = "parsing grammar");
      const source = peggy.generate(input, this.argv); // All of the real work.

      this.verbose("CLI", errorText = "open output stream");
      const outputStream = await this.openOutputStream();

      // If option `--ast` is specified, `generate()` returns an AST object
      if (this.progOptions.ast) {
        this.verbose("CLI", errorText = "writing AST");
        await this.writeOutput(outputStream, JSON.stringify(source, null, 2));
      } else {
        this.verbose("CLI", errorText = "writing sourceMap");
        const mappedSource = await this.writeSourceMap(source);

        this.verbose("CLI", errorText = "writing parser");
        await this.writeOutput(outputStream, mappedSource);

        exitCode = 2;
        this.verbose("CLI", errorText = "running test");
        this.test(mappedSource);
      }
    } catch (error) {
      // Will either exit or throw.
      this.error(errorText, {
        error,
        exitCode,
        code: "peggy.cli",
        sources: [{
          source: this.argv.grammarSource,
          text: input,
        }, {
          source: this.testGrammarSource,
          text: this.testText,
        }],
      });
    }
    return 0;
  }

  // For some reason, after running through rollup, typescript can't see
  // methods from the base class.

  /**
   * @param {string[]} [argv] - optional, defaults to process.argv
   * @param {Object} [parseOptions] - optionally specify style of options with from: node/user/electron
   * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
   * @return {PeggyCLI} `this` command for chaining
   */
  parse(argv?: string[], parseOptions?: { from: "node" | "electron" | "user" }): this {
    return super.parse(argv, parseOptions);
  }

  /**
   * @param {Object} [configuration] - configuration options
   * @return {PeggyCLI} `this` command for chaining, or stored configuration
   */
  configureHelp(configuration: HelpConfiguration): this;

  configureHelp(): HelpConfiguration;

  configureHelp(configuration?: HelpConfiguration): this | HelpConfiguration {
    return super.configureHelp(configuration);
  }

  /**
   * @param {Object} [configuration] - configuration options
   * @return {PeggyCLI} `this` command for chaining, or stored configuration
   */
  configureOutput(configuration: OutputConfiguration): this;

  configureOutput(): OutputConfiguration;

  configureOutput(
    configuration?: OutputConfiguration,
  ): this | OutputConfiguration {
    return super.configureOutput(configuration);
  }

  /**
   * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
   * @return {PeggyCLI} `this` command for chaining
   */
  exitOverride(fn) {
    return super.exitOverride(fn);
  }
}
