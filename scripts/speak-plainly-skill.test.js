const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(PROJECT_ROOT, 'skills', 'speak-plainly');
const SKILL_PATH = path.join(SKILL_DIR, 'SKILL.md');
const OPENAI_YAML_PATH = path.join(SKILL_DIR, 'agents', 'openai.yaml');

function readRequired(filePath) {
  assert.ok(fs.existsSync(filePath), `Missing required file: ${path.relative(PROJECT_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  return match[1];
}

test('skill: package uses the approved portable name and minimal structure', () => {
  const skill = readRequired(SKILL_PATH);
  const yaml = frontmatter(skill);
  assert.match(yaml, /^name: speak-plainly$/m);
  assert.match(yaml, /^description: Use when /m);
  assert.equal((yaml.match(/^[a-z_]+:/gm) || []).length, 2, 'frontmatter should contain only name and description');

  const files = fs.readdirSync(SKILL_DIR).sort();
  assert.deepEqual(files, ['SKILL.md', 'agents']);
});

test('skill: trigger covers task communication without embedding the workflow', () => {
  const yaml = frontmatter(readRequired(SKILL_PATH));
  assert.match(yaml, /task updates|progress updates/i);
  assert.match(yaml, /findings|recommendations/i);
  assert.match(yaml, /risk|decision/i);
  assert.match(yaml, /handoffs|final answers/i);
  assert.match(yaml, /business users|product managers|nontechnical/i);
  assert.doesNotMatch(yaml, /lead with|first sentence|translate jargon/i);
});

test('skill: body protects clarity, natural tone, status accuracy, and technical evidence', () => {
  const skill = readRequired(SKILL_PATH);
  const body = skill.replace(/^---[\s\S]*?---\n/, '');
  const wordCount = (body.match(/\b[\w'-]+\b/g) || []).length;

  assert.ok(wordCount <= 500, `SKILL.md body should stay under 500 words, got ${wordCount}`);
  assert.match(body, /lead with|answer first/i);
  assert.match(body, /reader|audience/i);
  assert.match(body, /plain language|explain.*term|jargon/i);
  assert.match(body, /planned/i);
  assert.match(body, /in progress|implemented/i);
  assert.match(body, /automated checks|automated verification/i);
  assert.match(body, /human acceptance|human verification|accepted by/i);
  assert.match(body, /blocked|remaining risk/i);
  assert.match(body, /file paths|commands|error messages/i);
  assert.match(body, /natural|rigid template/i);
  assert.match(body, /Before:/);
  assert.match(body, /After:/);
  assert.match(body, /Common mistakes/i);
  assert.match(body, /Before sending/i);
});

test('skill: body remains reusable outside the current project', () => {
  const skill = readRequired(SKILL_PATH);
  assert.doesNotMatch(skill, /WES|WorkEvolutionSys|Harness|NightOps|\/Users\/|apps\/api|ui\/V2/i);
});

test('skill: UI metadata is complete and dependency-free', () => {
  const yaml = readRequired(OPENAI_YAML_PATH);
  assert.match(yaml, /display_name: "Speak Plainly"/);
  assert.match(yaml, /short_description: ".{25,64}"/);
  assert.match(yaml, /default_prompt: ".*\$speak-plainly.*"/);
  assert.doesNotMatch(yaml, /dependencies:|icon_small:|icon_large:|brand_color:/);
});

test('entry: every WES model entry points to the shared skill', () => {
  for (const entry of ['AGENTS.md', 'CLAUDE.md', 'QODER.md', 'KIMICODE.md']) {
    const content = readRequired(path.join(PROJECT_ROOT, entry));
    assert.match(content, /skills\/speak-plainly\/SKILL\.md/, `${entry} must reference Speak Plainly`);
  }
});
