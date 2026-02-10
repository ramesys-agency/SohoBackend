/**
 * Custom rule to enforce Jira ticket reference in commit messages.
 * Format: UG-<number> (e.g., UG-50, UG-123)
 */
const jiraTicketRule = (parsed) => {
    const { header, body, footer } = parsed;
    const fullMessage = [header, body, footer].filter(Boolean).join("\n");
    const jiraPattern = /UG-\d+/;

    if (jiraPattern.test(fullMessage)) {
        return [true];
    }

    return [false, "Commit message must include a Jira ticket reference (e.g., UG-50, UG-123)"];
};

export default {
    extends: ["@commitlint/config-conventional"],
    plugins: [
        {
            rules: {
                "jira-ticket-reference": jiraTicketRule,
            },
        },
    ],
    rules: {
        "type-enum": [
            2,
            "always",
            [
                "feat",
                "fix",
                "docs",
                "style",
                "refactor",
                "perf",
                "test",
                "build",
                "ci",
                "chore",
                "revert",
            ],
        ],
        "jira-ticket-reference": [2, "always"],
    },
};
