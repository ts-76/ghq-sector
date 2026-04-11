import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

export async function prompt(label: string, defaultValue: string) {
  const rl = createInterface({ input, output });
  const answer = await rl.question(`${label} [${defaultValue}]: `);
  rl.close();
  return answer.trim() || defaultValue;
}

export async function selectFromChoices(
  label: string,
  choices: string[],
  defaultIndex = 0,
) {
  for (const [index, choice] of choices.entries()) {
    output.write(`  ${index + 1}. ${choice}\n`);
  }

  const defaultChoice = String(defaultIndex + 1);
  const selected = await prompt(label, defaultChoice);
  const selectedIndex = Number.parseInt(selected, 10) - 1;

  if (
    Number.isNaN(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= choices.length
  ) {
    return null;
  }

  return {
    index: selectedIndex,
    value: choices[selectedIndex],
  };
}
