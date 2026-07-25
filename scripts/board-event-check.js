#!/usr/bin/env node

const { readEventFile, validateBoardEvent } = require('./board-event-lib');

function main() {
  const file = process.argv[2];
  if (!file || ['-h', '--help'].includes(file)) {
    console.log('Usage: node scripts/board-event-check.js <event.json>');
    process.exit(file ? 0 : 1);
  }

  let event;
  try {
    event = readEventFile(file);
  } catch (error) {
    console.error(`Failed to read event: ${error.message}`);
    process.exit(1);
  }

  const result = validateBoardEvent(event);
  if (result.errors.length) {
    console.error('Board event validation failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Board event OK: ${result.event.id}`);
}

main();
