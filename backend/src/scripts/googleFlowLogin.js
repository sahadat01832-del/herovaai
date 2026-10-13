const { spawn } = require('node:child_process');
const {
  FLOW_URL,
  PROFILE_DIR,
  findBraveExecutable,
  buildBraveArgs,
  prepareBraveProfile,
} = require('../services/googleFlowService');

async function main() {
  await prepareBraveProfile();
  const executablePath = findBraveExecutable();
  console.error(`Opening normal Brave (without automation flags) in its separate "${PROFILE_DIR}" profile. Sign in there; your everyday Brave profile remains untouched.`);
  const browser = spawn(executablePath, buildBraveArgs({
    profileDir: PROFILE_DIR,
    headless: false,
    url: FLOW_URL,
  }), { stdio: 'inherit' });
  browser.once('error', (error) => {
    console.error(`Could not open Brave: ${error.message}`);
    process.exitCode = 1;
  });
  browser.once('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`Brave exited with code ${code}.`);
      process.exitCode = code;
    } else if (signal) {
      console.error(`Brave closed with signal ${signal}.`);
    }
  });
  await new Promise((resolve, reject) => {
    browser.once('error', reject);
    browser.once('exit', resolve);
  });
}

main().catch((error) => {
  console.error(`Could not open Google Flow login: ${error.message}`);
  process.exitCode = 1;
});
