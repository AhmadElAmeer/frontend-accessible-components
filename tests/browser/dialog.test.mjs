import { test } from "node:test";
import assert from "node:assert/strict";
import { skip, demoPage, invariants, focused, rng } from "./harness.mjs";

const isOpen = (page, id) => page.evaluate((id) => window.demo.dialogs[id].isOpen, id);

async function openWithKeyboard(page, buttonText) {
  await page.focus(`button:text-is("${buttonText}")`);
  await page.keyboard.press("Enter");
}

test("open from the keyboard: focus goes to the safe default; Escape closes and returns focus", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Delete project…");
  assert.ok(await isOpen(page, "dialog-delete"));
  assert.equal(await focused(page), "Cancel", "data-autofocus puts focus on Cancel, not Delete");
  await invariants(page, "while open");
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(page, "dialog-delete"), false);
  assert.equal(await focused(page), "Delete project…");
  assert.equal(await page.textContent("#dialog-result"), "Nothing was deleted.");
  await invariants(page, "after closing");
  // And the button that confirms: Tab to Delete, Enter.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.equal(await page.textContent("#dialog-result"), "Project deleted (not really).");
  assert.equal(await focused(page), "Delete project…");
  await page.done();
});

test("Tab and Shift+Tab wrap inside the dialog", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Delete project…");
  const order = [];
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    order.push(await focused(page));
  }
  assert.deepEqual(order, ["Delete", "Cancel", "Delete", "Cancel", "Delete", "Cancel"]);
  await page.done();
});

test("model check: 300 random Tab/Shift+Tab presses never leave the dialog", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Edit profile…");
  const rand = rng(7);
  // The dialog's tabbable elements, in order; the model is "index moves ±1 with wrap".
  const items = ["profile-name", "profile-country", "profile-cancel", "Save"];
  let at = 0;
  for (let i = 0; i < 300; i++) {
    const back = rand() < 0.5;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    at = (at + (back ? -1 : 1) + items.length) % items.length;
    assert.equal(await focused(page), items[at], `press ${i}`);
  }
  await invariants(page);
  await page.done();
});

test("the page behind is inert: not focusable, not clickable, not scrollable", { skip }, async () => {
  const page = await demoPage();
  await page.evaluate(() => window.scrollTo(0, 0));
  await openWithKeyboard(page, "Delete project…");
  // Programmatic focus on an inert element is refused.
  await page.evaluate(() => document.getElementById("country").focus());
  assert.equal(await focused(page), "Cancel");
  // A click on the backdrop over a page control closes the dialog instead of reaching the control.
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "hidden");
  await page.mouse.click(5, 5);
  assert.equal(await isOpen(page, "dialog-delete"), false);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
  assert.equal(await page.evaluate(() => [...document.body.children].filter((c) => c.inert).length), 0, "everything un-inerted");
  await page.done();
});

test("nested dialogs: Escape with unsaved changes asks first; each Escape closes only the top dialog", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Edit profile…");
  assert.equal(await focused(page), "profile-name");
  await page.keyboard.press("End");
  await page.keyboard.type(" K.");
  await page.keyboard.press("Escape");
  // The profile dialog stays open; the confirmation opens on top of it.
  assert.ok(await isOpen(page, "dialog-profile"));
  assert.ok(await isOpen(page, "dialog-discard"));
  assert.equal(await focused(page), "Keep editing");
  await invariants(page, "two dialogs open");
  await page.keyboard.press("Escape"); // closes only the confirmation
  assert.ok(await isOpen(page, "dialog-profile"));
  assert.equal(await isOpen(page, "dialog-discard"), false);
  assert.equal(await focused(page), "profile-name", "focus returns into the first dialog");
  assert.equal(await page.inputValue("#profile-name"), "Ahmad K.");
  await invariants(page, "back to one dialog");
  // Escape again, then choose Discard: both close and the edit is undone.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  assert.equal(await focused(page), "Discard");
  await page.keyboard.press("Enter");
  assert.equal(await isOpen(page, "dialog-profile"), false);
  assert.equal(await isOpen(page, "dialog-discard"), false);
  assert.equal(await page.inputValue("#profile-name"), "Ahmad");
  assert.equal(await focused(page), "Edit profile…");
  await invariants(page, "all closed");
  await page.done();
});

test("Escape in an open combobox inside a dialog closes the list, not the dialog", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Edit profile…");
  await page.keyboard.press("Tab");
  await page.keyboard.type("isr");
  assert.equal(await page.getAttribute("#profile-country", "aria-expanded"), "true");
  await invariants(page, "list open in dialog");
  await page.keyboard.press("Escape");
  assert.equal(await page.getAttribute("#profile-country", "aria-expanded"), "false");
  assert.ok(await isOpen(page, "dialog-profile"));
  // Second Escape clears the text box (the combobox's rule), third reaches the dialog.
  await page.keyboard.press("Escape");
  assert.equal(await page.inputValue("#profile-country"), "");
  assert.ok(await isOpen(page, "dialog-profile"));
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(page, "dialog-profile"), false);
  await page.done();
});

test("submitting the form saves and closes; Enter on an option doesn't submit", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Edit profile…");
  await page.keyboard.press("Tab");
  await page.keyboard.type("jord");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter"); // picks Jordan; the form must stay open
  assert.equal(await page.inputValue("#profile-country"), "Jordan");
  assert.ok(await isOpen(page, "dialog-profile"));
  await page.keyboard.press("Enter"); // now it submits
  assert.equal(await isOpen(page, "dialog-profile"), false);
  assert.equal(await page.textContent("#dialog-result"), "Profile saved: Ahmad, Jordan.");
  await page.done();
});

test("if the opener is gone when the dialog closes, focus doesn't get lost in an inert page", { skip }, async () => {
  const page = await demoPage();
  await openWithKeyboard(page, "Delete project…");
  // Checked in the same task as close(): Chrome would blur the hidden button on
  // its next rendering update anyway, but until then keystrokes would go to it,
  // and not every browser does that clean-up.
  const after = await page.evaluate(() => {
    document.querySelector('[data-opens="dialog-delete"]').remove();
    window.demo.dialogs["dialog-delete"].close("escape");
    return { onBody: document.activeElement === document.body, inert: [...document.body.children].some((c) => c.inert) };
  });
  assert.deepEqual(after, { onBody: true, inert: false });
  await page.done();
});

test("data-autofocus wins over document order; without it the first control gets focus; no controls: the dialog", { skip }, async () => {
  const page = await demoPage();
  const result = await page.evaluate(async () => {
    const { Dialog } = await import("/src/index.js");
    const make = (html) => {
      const el = document.createElement("div");
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Test");
      el.innerHTML = html;
      document.body.append(el);
      return new Dialog(el);
    };
    const out = [];
    for (const html of [
      '<button>Delete</button><button data-autofocus>Cancel</button>',
      '<p>Text</p><a href="#x">Link</a><button>OK</button>',
      '<p>Only text</p>',
    ]) {
      const d = make(html);
      d.open(document.querySelector("h1"));
      const a = document.activeElement;
      out.push(a === d.el ? "dialog" : a.textContent);
      d.close();
    }
    // Markup mistakes are reported when the component is created, not discovered by users.
    const errors = [];
    const noRole = document.createElement("div");
    const noName = document.createElement("div");
    noName.setAttribute("role", "dialog");
    for (const el of [noRole, noName]) {
      try { new Dialog(el); } catch (e) { errors.push(e.message); }
    }
    return { out, errors };
  });
  assert.deepEqual(result.out, ["Cancel", "Link", "dialog"]);
  assert.match(result.errors[0], /role="dialog"/);
  assert.match(result.errors[1], /accessible name/);
  await page.done();
});
