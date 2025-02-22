
// bundling code reference: https://github.com/aws-samples/cdk-build-bundle-deploy-example/blob/main/cdk-bundle-static-site-example/lib/static-site-stack.ts

/**
 * This code is necessary for bundling the Lambda layers and functions where each layer and function has its own dependencies.
 * The code is used to install the dependencies for each layer and function and then copy the node_modules folder to the output directory.
 * The output directory is where the CDK will look for the bundled code.
 *
 */

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

/**
 * Builds the distribution by installing dependencies and copying files.
 *
 * @param {string} entry - The entry directory where the source files are located.
 * @param {string} outputDir - The output directory where the built files will be copied.
 * @param {Object} props - Additional properties for the build process.
 * @param {string} [props.nodejsPath] - Optional path to the Node.js project within the entry directory ('nodejs' for layers).
 * @param {Object} [props.env] - Optional environment variables to be used during the build process.
 * @returns {boolean} - Returns true if the build process succeeds, otherwise false.
 */
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
