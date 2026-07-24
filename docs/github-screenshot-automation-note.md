# GitHub Screenshot Automation Note

Status: proposed.

This note describes a possible screenshot workflow for `llm-workbench` and the
services exposed through it. The goal is to generate consistent screenshots for
the GitHub repositories without keeping duplicate image files in every repo.

## Proposed Ownership

Use one public standalone repository for both:

- the Playwright automation
- safe input fixtures
- generated screenshots

The script belongs in that repository rather than in `llm-workbench`. It spans
multiple service repositories and produces shared documentation assets.

The final repository name is not decided. `project-screenshots` is used below
as a placeholder.

## Repository Layout

Keep one top-level output directory per repository represented in the
Workbench. Within it, keep one directory per actual sidebar view.

```text
project-screenshots/
├── automation/
│   ├── capture.py
│   └── scenarios.yaml
├── fixtures/
├── llm-pool/
│   └── models/
│       ├── overview.png
│       └── <actual-expanded-section>.png
└── translation-services/
    └── pdf-translation/
        ├── overview.png
        └── <actual-expanded-section>.png
```

A view may have several screenshots. Capture one expanded detail section at a
time when opening all sections would make the page too large.

Derive filenames from the real Workbench view and section identifiers. Do not
define screenshot states until the corresponding UI has been inspected.

## GitHub Embedding

Other repositories can embed images from the standalone repository without
copying them locally:

```markdown
![LLM model management](https://raw.githubusercontent.com/Bobcat/project-screenshots/main/llm-pool/models/<filename>.png)
```

`main` is the branch name. Replacing the file at the same path keeps the URL
stable, so consuming README files do not need to change. GitHub's image proxy
may continue to show a cached version for a while.

The screenshot repository must be public when the images appear in public
repositories. A private source image is only available to viewers with access
to that repository.

Central hosting has two trade-offs:

- renaming, privatizing, or deleting the screenshot repository breaks the links
- locally rendered README files need network access to load the images

## Playwright Role

Playwright controls a real browser. It can:

- open Workbench views
- click the actual sidebar actions
- expand and collapse existing detail sections
- scroll elements into view
- upload fixture files
- wait for backend-driven progress and completion
- capture a viewport, full page, DOM element, or coordinate crop

Headless mode still renders the page to pixels. The DOM is used to locate and
operate elements. Screenshots contain the browser-rendered HTML, CSS, fonts,
images, SVG, and canvas content. They do not contain browser chrome, native file
dialogs, or the desktop environment.

## Recording On A Desktop

Playwright Codegen can record a first version of a browser flow on a desktop
machine:

```bash
playwright codegen --viewport-size="1440,1000" http://127.0.0.1:8012
```

Codegen opens a browser and the Playwright Inspector. It records clicks, input,
and candidate locators while the user navigates the Workbench.

The recording is a starting point. Review it before headless use:

- remove accidental actions
- replace machine-specific paths
- keep selectors based on stable roles, labels, or test ids
- add explicit completion conditions
- add screenshot calls at the intended states
- set deterministic theme, viewport, and browser state

The desktop and headless runners must be able to reach the same Workbench URL.
When the Workbench runs on a remote host, use an SSH or editor port forward for
desktop recording.

## Capture Sequence

Each configured scenario should describe a real Workbench view and a safe set
of actions.

A detail-section sequence is:

1. Open the sidebar view.
2. Wait until the view's data is ready.
3. Reset expandable sections to their closed state.
4. Capture the overview if that state is useful.
5. Open one actual section.
6. Wait for its transition and content to settle.
7. Scroll it into view.
8. Capture the configured viewport or element crop.
9. Close the section.
10. Continue with the next configured section.

Do not infer scenarios by clicking every button. Workbench views contain actions
that can change service state. The scenario configuration should allow only the
specific actions needed for screenshots.

## Screenshot Shapes

Use a fixed viewport for screenshots that need Workbench context. A size such
as `1440x1000` is a reasonable starting point, but the final value should be
chosen once and stored in configuration.

Playwright supports:

- viewport screenshots for the sidebar and surrounding context
- full-page screenshots for suitable short pages
- locator screenshots cropped to one rendered element
- coordinate clips for regions that do not map to one element

Use locator crops for focused documentation. Use viewport screenshots for
repository landing pages where the Workbench context matters.

## File Uploads

A headless host does not need a desktop file chooser. For a normal HTML file
input, Playwright assigns a path or in-memory file directly with
`set_input_files()`.

The selected file must exist on the machine running Playwright. Use small,
deterministic fixtures or a configured external fixture directory. Do not
commit private documents or credentials to a public screenshot repository.

Codegen may record an absolute path from the desktop machine. Replace it with a
repository-relative fixture path before running the script elsewhere.

A view that uses a native File System Access API instead of a regular file input
needs a view-specific solution. Confirm the actual implementation during the UI
inventory.

## Long-Running Workflows

Translation and generation jobs can run for several minutes. Do not use a fixed
sleep and do not treat page network-idle state as job completion.

Wait for a real terminal condition exposed by the current UI, such as the
presence of the final result. Set a workflow-specific timeout that is longer
than the expected job duration.

A spinner disappearing is not enough. It may also disappear after a failure.
After waiting, verify the actual success state. On timeout or failure, save a
diagnostic screenshot and stop that scenario.

Progress screenshots can use real intermediate UI states when those states are
part of the intended documentation. Define those waits from the current DOM and
status behavior.

## Reproducibility

Set these values explicitly for every run:

- browser engine and version
- viewport size and device scale factor
- light or dark theme
- locale and timezone when visible in the UI
- sidebar state
- fixture inputs
- service and model state needed by the scenario

Use a fresh browser context unless a scenario intentionally depends on stored
state. Wait for CSS transitions before capture or disable them during the
screenshot call.

Live service data can make screenshots vary. Prefer safe representative inputs
and known service state. Mocking may be useful for documentation of transient
states, but screenshots presented as real output must come from a real run.

## Safety Boundary

The screenshot runner must not explore the UI by clicking arbitrary controls.
Its scenario list should separate:

- read-only navigation and detail expansion
- explicitly authorized workflow execution
- forbidden state-changing operations

Model load, unload, deletion, cancellation, and similar controls must remain
outside screenshot scenarios unless a specific scenario is reviewed and
approved.

Before publishing, inspect screenshots for:

- API keys and tokens
- local filesystem paths
- internal hostnames or addresses
- private prompts and documents
- personal or customer data

## Suggested First Slice

1. Inventory the actual sidebar views and expandable sections.
2. Choose one safe Workbench view.
3. Record its navigation with Codegen on the desktop machine.
4. Clean the generated script and add explicit screenshot points.
5. Run the same scenario headless.
6. Compare the desktop and headless output.
7. Create the standalone repository after the structure and naming work for the
   first real scenario.

Do not automate every view before this first slice is stable.

## References

- [Playwright for Python](https://playwright.dev/python/)
- [Playwright Codegen](https://playwright.dev/python/docs/codegen)
- [Playwright file chooser](https://playwright.dev/python/docs/api/class-filechooser)
- [GitHub relative links and image paths](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#relative-links)
- [GitHub anonymized image URLs and caching](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)
