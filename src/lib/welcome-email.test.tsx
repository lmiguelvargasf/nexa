import { render } from "react-email";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadTemplate(appUrl?: string) {
  vi.stubEnv("APP_URL", appUrl);
  vi.resetModules();
  return (await import("../../emails/welcome")).default;
}

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("welcome email rendering", () => {
  it("preserves the preview copy, hidden preheader, and appearance", async () => {
    const WelcomeTemplate = await loadTemplate();
    const email = <WelcomeTemplate {...WelcomeTemplate.PreviewProps} />;
    const document = parseHtml(await render(email));

    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector("h1")?.textContent).toBe("Welcome to Nexa");
    expect(
      Array.from(document.querySelectorAll("p"), (p) => p.textContent),
    ).toEqual(["Hello Ada,", "Your Nexa workspace is ready."]);
    const preview = document.querySelector<HTMLElement>("[data-skip-in-text]");
    expect(preview?.firstChild?.textContent).toBe("Welcome to Nexa");
    expect(preview?.style.display).toBe("none");

    expect(document.body.style.backgroundColor).toBe("rgb(246, 247, 249)");
    const container = document.querySelector<HTMLElement>(
      'table[style*="max-width"]',
    );
    expect(container?.style.maxWidth).toBe("37.5em");
    expect(container?.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(container?.style.borderRadius).toBe("8px");
    expect(container?.querySelector("td")?.style.padding).toBe("32px");

    const button = document.querySelector("a");
    expect(button?.textContent).toBe("Open Nexa");
    expect(button?.getAttribute("href")).toBe("http://localhost:3000");
    expect(button?.style.backgroundColor).toBe("rgb(24, 24, 27)");
    expect(button?.style.color).toBe("rgb(255, 255, 255)");
    expect(button?.style.padding).toBe("12px 16px");

    expect(await render(email, { plainText: true })).toBe(
      "WELCOME TO NEXA\n\nHello Ada,\n\nYour Nexa workspace is ready.\n\nOpen Nexa http://localhost:3000",
    );
  });

  it("uses the default greeting when the name is omitted", async () => {
    const WelcomeTemplate = await loadTemplate();
    const document = parseHtml(await render(<WelcomeTemplate />));

    expect(document.querySelector("p")?.textContent).toBe("Hello there,");
  });

  it("renders supplied names as text", async () => {
    const WelcomeTemplate = await loadTemplate();
    const document = parseHtml(
      await render(<WelcomeTemplate name="<Ada & Grace>" />),
    );

    expect(document.querySelector("p")?.textContent).toBe(
      "Hello <Ada & Grace>,",
    );
    expect(document.querySelector("p")?.children).toHaveLength(0);
  });

  it.each([
    {
      description: "trimmed explicit URL over the environment",
      env: "https://env.example.com",
      appUrl: " https://example.com/workspace ",
      expected: "https://example.com/workspace",
    },
    {
      description: "trimmed environment URL when the prop is omitted",
      env: " https://env.example.com ",
      appUrl: undefined,
      expected: "https://env.example.com",
    },
    {
      description: "localhost when the environment is unset",
      env: undefined,
      appUrl: undefined,
      expected: "http://localhost:3000",
    },
    {
      description: "localhost when the environment is blank",
      env: "  ",
      appUrl: undefined,
      expected: "http://localhost:3000",
    },
    {
      description: "localhost when the explicit URL is empty",
      env: "https://env.example.com",
      appUrl: "",
      expected: "http://localhost:3000",
    },
    {
      description: "localhost when the explicit URL is whitespace",
      env: "https://env.example.com",
      appUrl: "  ",
      expected: "http://localhost:3000",
    },
  ])("uses $description", async ({ env, appUrl, expected }) => {
    const WelcomeTemplate = await loadTemplate(env);
    const email = <WelcomeTemplate appUrl={appUrl} />;
    const document = parseHtml(await render(email));

    expect(document.querySelector("a")?.getAttribute("href")).toBe(expected);
    expect(await render(email, { plainText: true })).toContain(
      `Open Nexa ${expected}`,
    );
  });
});
