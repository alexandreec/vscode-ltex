import * as ChildProcess from 'child_process';
import * as CodeTest from 'vscode-test';
import * as CodeTestRunTest from 'vscode-test/out/runTest';
import * as Fs from 'fs';
import * as Path from 'path';
import * as Rimraf from 'rimraf';

import {version as ltexVersion} from '../package.json';

let ltexDirPath: string;
let vscodeExecutablePath: string;
let cliPath: string;

async function runTestIteration(testIteration: number): Promise<void> {
  console.log('');
  console.log(`Running test iteration ${testIteration}...`);

  const tmpDirPrefix: string = Path.join(ltexDirPath, 'tmp-');
  console.log(`Creating temporary directory with prefix '${tmpDirPrefix}'...`);
  const tmpDirPath: string = Fs.mkdtempSync(tmpDirPrefix);
  console.log(`Created temporary directory '${tmpDirPath}'.`);

  const ltexLibDirPath: string = Path.join(ltexDirPath, 'lib');
  const gitCleanArgs: string[] = ['-C', ltexDirPath, 'clean', '-f', '-x', ltexLibDirPath];
  console.log(`Cleaning '${ltexLibDirPath}'...`);
  const childProcess: ChildProcess.SpawnSyncReturns<string> = ChildProcess.spawnSync(
      'git', gitCleanArgs, {encoding: 'utf-8', timeout: 10000});

  if (childProcess.status != 0) {
    throw new Error(`Could not clean '${ltexLibDirPath}'. ` +
        `Exit code: ${childProcess.status}. stdout: '${childProcess.stdout}'. ` +
        `stderr: '${childProcess.stderr}'.`);
  }

  const originalPath: string | undefined = process.env['PATH'];
  const originalJavaHome: string | undefined = process.env['JAVA_HOME'];

  try {
    const userDataDirPath: string = Path.join(tmpDirPath, 'user');
    const extensionsDirPath: string = Path.join(tmpDirPath, 'extensions');
    const cliArgs: string[] = [
          '--user-data-dir', userDataDirPath,
          '--extensions-dir', extensionsDirPath,
          '--install-extension', 'james-yu.latex-workshop',
        ];

    if (testIteration == 2) {
      let platform: string = 'linux';
      if (process.platform == 'darwin') platform = 'mac';
      else if (process.platform == 'win32') platform = 'windows';
      cliArgs.push('--install-extension', Path.join(ltexDirPath,
          `vscode-ltex-${ltexVersion}-offline-${platform}-x64.vsix`));
    }

    console.log('Calling Code CLI for extension installation...');
    const childProcess: ChildProcess.SpawnSyncReturns<string> = ChildProcess.spawnSync(
        cliPath, cliArgs, {encoding: 'utf-8', stdio: 'inherit'});

    if (childProcess.status != 0) throw new Error('Could not install extensions.');

    if (testIteration == 0) {
      const mockJavaDirPath: string = Path.join(tmpDirPath, 'bin');
      Fs.mkdirSync(mockJavaDirPath);
      const mockJavaPath: string = Path.join(mockJavaDirPath, 'java');
      console.log(`Creating mock Java executable '${mockJavaPath}'...`);
      Fs.writeFileSync(mockJavaPath, '\n', {mode: 0o777});
      process.env['PATH'] = ((process.env['PATH'] != null) ?
          `${mockJavaDirPath}${Path.delimiter}${process.env['PATH']}` : mockJavaDirPath);
      process.env['JAVA_HOME'] = '/nonExistentDirectory';
    } else {
      process.env['PATH'] = originalPath;
      process.env['JAVA_HOME'] = originalJavaHome;
    }

    if (testIteration == 2) {
      console.log(`Removing '${ltexLibDirPath}'...`);
      Rimraf.sync(ltexLibDirPath);
      const ltexOfflineLibDirPath: string =
          Path.join(extensionsDirPath, `valentjn.vscode-ltex-${ltexVersion}`, 'lib');
      console.log(`Moving '${ltexOfflineLibDirPath}' to '${ltexLibDirPath}'...`);
      Fs.renameSync(ltexOfflineLibDirPath, ltexLibDirPath);
    }

    const env: NodeJS.ProcessEnv = {};

    for (const name in process.env) {
      if (Object.prototype.hasOwnProperty.call(process.env, name)) {
        env[name] = process.env[name];
      }
    }

    env['LTEX_DEBUG'] = '1';

    const testOptions: CodeTestRunTest.TestOptions = {
          vscodeExecutablePath: vscodeExecutablePath,
          launchArgs: [
            '--user-data-dir', userDataDirPath,
            '--extensions-dir', extensionsDirPath,
          ],
          extensionDevelopmentPath: ltexDirPath,
          extensionTestsPath: Path.join(__dirname, './index'),
          extensionTestsEnv: env,
        };

    console.log('Running tests...');
    const exitCode: number = await CodeTest.runTests(testOptions);

    if (exitCode != 0) throw new Error(`Test returned exit code ${exitCode}.`);
  } finally {
    if (tmpDirPath != null) Rimraf.sync(tmpDirPath);
  }

  return Promise.resolve();
}

async function main(): Promise<void> {
  let fastMode: boolean = false;

  for (const arg of process.argv) {
    if (arg == '--fast') fastMode = true;
  }

  ltexDirPath = Path.resolve(__dirname, '..', '..');
  let codeVersion: string = 'stable';
  let codePlatform: string | undefined;

  if (process.platform == 'win32') {
    codeVersion = '1.35.1';
    codePlatform = 'win32-x64-archive';
  }

  console.log('Downloading and installing VS Code...');
  vscodeExecutablePath = await CodeTest.downloadAndUnzipVSCode(codeVersion, codePlatform);

  console.log('Resolving CLI path to VS Code...');
  cliPath = CodeTest.resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);

  for (let testIteration: number = 0; testIteration < 3; testIteration++) {
    if (fastMode && (testIteration != 1)) continue;
    await runTestIteration(testIteration);
  }

  return Promise.resolve();
}

main();
