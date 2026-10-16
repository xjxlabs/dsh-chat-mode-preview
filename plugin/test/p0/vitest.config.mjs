import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.env.DSH_SOURCE_ROOT ?? resolve(here, '../../../deepseek-harness'));
const requireDsh = createRequire(resolve(source, 'package.json'));
const ts = requireDsh('typescript');
const parsed = ts.readConfigFile(resolve(source, 'tsconfig.base.json'), ts.sys.readFile);
if (parsed.error) throw new Error('Cannot read DSH source alias configuration');
const alias = Object.entries(parsed.config.compilerOptions.paths).map(([name, targets]) => ({
  find: new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)')}$`),
  replacement: resolve(source, targets[0]).replaceAll('\\', '/').replace('*', '$1'),
}));
alias.push({ find: 'vitest', replacement: resolve(dirname(requireDsh.resolve('vitest/package.json')), 'dist/index.js') });
alias.unshift({ find: /^@deepseek-ai\/dsh-api-session-controller\/src\/(.*)$/,
  replacement: resolve(source, 'packages/api/session-controller/src/$1').replaceAll('\\', '/') });
alias.unshift({ find: 'p0-workspace-navigation',
  replacement: resolve(source, 'packages/client/ui-workspace/src/client/navigation.ts').replaceAll('\\', '/') });
export default {
  root: here,
  resolve: { alias },
  plugins: [{ name: 'p0-standard-decorators', enforce: 'pre', transform(code, id) {
    if (!/\.[cm]?tsx?$/.test(id) || !/^\s*@[A-Za-z_$]/m.test(code)) return;
    const output = ts.transpileModule(code, { fileName: id, compilerOptions: {
      target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, sourceMap: true,
    } });
    return { code: output.outputText, map: output.sourceMapText };
  } }],
  test: { include: ['dsh-contract.spec.ts'], pool: 'forks', maxWorkers: 1,
    testTimeout: 20000, hookTimeout: 20000,
    execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [] },
};
