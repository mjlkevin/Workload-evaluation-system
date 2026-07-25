#!/usr/bin/env node

const {
  DEFAULT_REGISTRY_PATH,
  readWorkItemRegistry,
  validateWorkItemRegistry,
  writeWorkItemPages,
} = require('./board-work-items-lib');

function main() {
  const registryPath = process.argv[2] || DEFAULT_REGISTRY_PATH;
  const registry = readWorkItemRegistry(registryPath);
  const { errors } = validateWorkItemRegistry(registry);

  if (errors.length) {
    console.error('Work item registry validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const outputs = writeWorkItemPages(registry);
  console.log(`Work item pages generated from ${registryPath}`);
  for (const output of outputs) console.log(`- ${output}`);
}

main();
