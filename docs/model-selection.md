# Agent model choices

Status: **implemented in the first milestone** · checked 2026-10-02

The model button in the agent composer opens a compact picker with model names and separate input/output prices in USD per million tokens. Choosing a row changes the model immediately and closes the picker. Arrow keys move between options, Enter selects, and Escape closes it. Each opening refreshes availability and prices from [OpenRouter's model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties); unknown prices appear as a dash, with a retry action if the request fails. The key icon in the top bar opens API key settings separately.

The six curated IDs below are in the installed Pi catalog. **Claude Sonnet 5** is the default for the first agent test. Models missing from the live tool-capable list are disabled in the picker, and no prices are hardcoded into the UI.

| Model ID | Why it is included |
| --- | --- |
| `anthropic/claude-sonnet-5` | Recommended first test for iterative edits and tool use. |
| `openai/gpt-6-sol` | Strong option for longer or more demanding coding changes. |
| `openai/gpt-6-luna` | Fast, lower-cost OpenAI comparison. |
| `qwen/qwen3-coder-next` | Coding-focused budget comparison. |
| `deepseek/deepseek-v4-flash-0731` | Inexpensive way to exercise the tool loop. |
| `moonshotai/kimi-k2.6` | Alternate model for coding and interface work. |

Changing models clears the hidden agent context so provider-specific tool and reasoning messages do not cross between models. The visible chat and project remain. The choice is saved immediately, and the selected model ID is recorded with each new assistant chat line. The API key stays in tab memory, so it must be re-entered after a reload.

Browser checks covered live price display for all six rows, keyboard and mouse selection, selection surviving an immediate reload, Escape dismissal, separate key settings, and a narrow window with no clipped price cells. The automated tests also cover free, missing, invalid, and small fractional prices.

The choices are based on [OpenRouter's tool-calling guide](https://openrouter.ai/docs/guides/features/tool-calling), its [coding collection](https://openrouter.ai/collections/programming), the individual [Claude Sonnet 5](https://openrouter.ai/anthropic/claude-sonnet-5), [GPT-6 Sol](https://openrouter.ai/openai/gpt-6-sol), [GPT-6 Luna](https://openrouter.ai/openai/gpt-6-luna), [Qwen3 Coder Next](https://openrouter.ai/qwen/qwen3-coder-next), [DeepSeek V4 Flash](https://openrouter.ai/deepseek/deepseek-v4-flash-0731), and [Kimi K2.6](https://openrouter.ai/moonshotai/kimi-k2.6) pages. [Official OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model) describes the GPT-6 family tradeoffs. Actual quality and tool reliability should be evaluated with the studio's to-do tasks; a listing only establishes availability and advertised support.

In the browser, Pi sends all OpenRouter models through the Chat Completions transport. Pi's built-in Claude entry uses OpenRouter's Messages transport, which failed browser preflight in this deployment. Claude Sonnet 5 and GPT-6 Luna were both exercised against a real project file through Pi's `read_file` tool after the transport adjustment. The other four choices are catalog-verified but still need live agent evaluations.
