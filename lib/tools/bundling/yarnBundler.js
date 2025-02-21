
// bundling code reference: https://github.com/aws-samples/cdk-build-bundle-deploy-example/blob/main/cdk-bundle-static-site-example/lib/static-site-stack.ts

const { spawnSync } = require('child_process');
const fs = require('fs-extra');

function exec(command, options) {
  const proc = spawnSync('bash', ['-c', command], options);

  if (proc.error) {
    throw proc.error;
  }

  if (proc.status != 0) {
    if (proc.stdout || proc.stderr) {
      throw new Error(`[Status ${proc.status}] stdout: ${proc.stdout?.toString().trim()}\n\n\nstderr: ${proc.stderr?.toString().trim()}`);
    }
    throw new Error(`go exited with status ${proc.status}`);
  }

  return proc;
}

function buildDist(entry, outputDir, props) {
  // Check that yarn is installed
  try {
    exec('yarn --version', {
      stdio: [
        'ignore',
        process.stderr,
        'inherit'
      ],
    });
  } catch {
    return false;
  }

  // yarn install node_modules
  try {
    const installPath = props?.nodejsPath ? `${entry}/${props.nodejsPath}` : `${entry}`;
    exec(
      [
        'yarn',
      ].join(' && '),
      {
        env: { ...process.env, ...props?.env ?? {} },
        stdio: [
          'ignore',
          process.stderr,
          'inherit'
        ],
        cwd: installPath // where to run the build command from
      }
    );

  } catch {
    return false;
  }

  // copy the folder to outputDir
  try {
    fs.copySync(entry, outputDir);
  } catch {
    return false;
  }

  return true;
}

module.exports = {
  buildDist,
}
