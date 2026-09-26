// The calls this repository's workflows make into shared-workflows, and the
// interface each called workflow declares. A call and its callee live in two
// repositories, so nothing but a test reading both notices when an input is
// renamed, a secret is dropped, or a required input stops being passed: the
// run fails at startup on main, after the change merged.
import { parse } from 'yaml';

/** The one repository these workflows call into. */
export const SHARED = 'blinkbitcoin/shared-workflows';

// `uses: owner/repo/.github/workflows/file.yml@ref  # comment`. The comment is
// read from the line itself: a YAML parser drops comments, and the version
// comment beside a SHA pin is what a person (and Dependabot) reads.
const USES_LINE = new RegExp(
  `^\\s*uses:\\s*${SHARED.replace('/', '\\/')}\\/\\.github\\/workflows\\/([\\w.-]+)@(\\S+)(?:\\s+#\\s*(.*\\S))?\\s*$`,
);

/**
 * Every `uses:` line in `text` that calls a shared workflow, in file order:
 * `{ line, workflow, ref, comment }`, `comment` being '' when there is none.
 */
export function pinsIn(text) {
  const pins = [];
  for (const [index, line] of text.split('\n').entries()) {
    const match = USES_LINE.exec(line);
    if (match) {
      const [, workflow, ref, comment = ''] = match;
      pins.push({ line: index + 1, workflow, ref, comment });
    }
  }
  return pins;
}

/**
 * Every job in a caller workflow that calls a shared workflow:
 * `{ job, workflow, ref, with, secrets, inheritsSecrets }`.
 */
export function callsIn(text) {
  const jobs = parse(text)?.jobs ?? {};
  const calls = [];
  for (const [job, spec] of Object.entries(jobs)) {
    const uses = typeof spec?.uses === 'string' ? spec.uses : '';
    const prefix = `${SHARED}/.github/workflows/`;
    if (!uses.startsWith(prefix)) continue;
    const [workflow, ref] = uses.slice(prefix.length).split('@');
    calls.push({
      job,
      workflow,
      ref,
      with: spec.with ?? {},
      secrets: spec.secrets === 'inherit' ? {} : (spec.secrets ?? {}),
      inheritsSecrets: spec.secrets === 'inherit',
    });
  }
  return calls;
}

/**
 * The inputs and secrets a reusable workflow declares under
 * `on.workflow_call`, or null when it is not callable at all.
 */
export function interfaceOf(text) {
  const call = parse(text)?.on?.workflow_call;
  if (call === undefined) return null;
  return { inputs: call?.inputs ?? {}, secrets: call?.secrets ?? {} };
}

/** An expression is decided at run time, so its type cannot be checked here. */
const isExpression = (value) => typeof value === 'string' && value.includes('${{');

// What each declared input type accepts as a literal. GitHub coerces nothing:
// `dry-run: 'true'` for a boolean input fails the run at startup.
const ACCEPTS = {
  boolean: (value) => typeof value === 'boolean',
  number: (value) => typeof value === 'number',
  string: (value) => typeof value === 'string',
};

/**
 * Why `call` does not fit `face`, one sentence per problem, or none. A secret
 * the callee declares as required must be passed unless the caller inherits
 * them all.
 */
export function contractProblems(call, face) {
  const where = `${call.job} -> ${call.workflow}`;
  if (!face) return [`${where}: the called workflow has no on.workflow_call`];
  const problems = [];
  for (const [name, value] of Object.entries(call.with)) {
    // Declared means present: `name:` with no body parses as null.
    if (!Object.hasOwn(face.inputs, name)) {
      problems.push(`${where}: input ${name} is not declared by the called workflow`);
      continue;
    }
    const accepts = ACCEPTS[face.inputs[name]?.type];
    if (accepts && !isExpression(value) && !accepts(value)) {
      problems.push(
        `${where}: input ${name} is a ${face.inputs[name].type}, got ${JSON.stringify(value)} (${typeof value})`,
      );
    }
  }
  for (const [name, input] of Object.entries(face.inputs)) {
    if (input?.required === true && !Object.hasOwn(call.with, name)) {
      problems.push(`${where}: required input ${name} is not passed`);
    }
  }
  for (const name of Object.keys(call.secrets)) {
    if (!Object.hasOwn(face.secrets, name)) {
      problems.push(`${where}: secret ${name} is not declared by the called workflow`);
    }
  }
  if (!call.inheritsSecrets) {
    for (const [name, secret] of Object.entries(face.secrets)) {
      if (secret?.required === true && !Object.hasOwn(call.secrets, name)) {
        problems.push(`${where}: required secret ${name} is not passed`);
      }
    }
  }
  return problems;
}
