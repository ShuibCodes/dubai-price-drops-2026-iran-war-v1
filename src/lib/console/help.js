export const HELP_COMMANDS = [
  "ask about a lead",
  "call <name>",
  "summary",
  "call my <list> with the <script> script",
];

export const HELP_TEXT = `From WhatsApp you can:

· ask about a lead
· call <name>
· summary
· call my <list> with the <script> script

Type a name, a list, or a script the same way you would say it out loud.`;

export function isHelpMessage(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[!?.]+$/g, "") === "help";
}
