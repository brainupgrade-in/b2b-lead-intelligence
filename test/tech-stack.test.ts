import { describe, it, expect } from 'vitest';
import { detectTechStack } from '../src/extractors/tech-stack.js';

describe('detectTechStack: precision', () => {
  // REGRESSION: CodeWeavers got Vue + Angular co-detected from a plain
  // WordPress site because the loose `/angular/i` and `/vue\.js/i` patterns
  // matched in CSS class names / blog content / copyright text.
  it('does not detect Angular from the bare word "angular" in HTML body text', () => {
    const html = '<html><body><p>We have an angular logo design</p><div class="angular-icon"></div></body></html>';
    const stack = detectTechStack(html);
    expect(stack.frameworks).not.toContain('Angular');
  });

  it('detects Angular only with a real signature (ng-version attribute)', () => {
    const html = '<html><body><app-root ng-version="17.0.0"></app-root></body></html>';
    const stack = detectTechStack(html);
    expect(stack.frameworks).toContain('Angular');
  });

  it('does not detect Vue from a blog post mentioning "vue.js"', () => {
    const html = '<html><body><h1>Why we love Vue.js</h1><p>vue.js is great</p></body></html>';
    const stack = detectTechStack(html);
    expect(stack.frameworks).not.toContain('Vue');
  });

  it('detects Vue only with a runtime signature (__VUE__)', () => {
    const html = '<html><body><script>window.__VUE__ = true;</script></body></html>';
    const stack = detectTechStack(html);
    expect(stack.frameworks).toContain('Vue');
  });

  it('detects Next.js by __NEXT_DATA__ or _next/static path, not bare "next"', () => {
    const noNext = detectTechStack('<html><body>The next chapter is coming</body></html>');
    expect(noNext.frameworks).not.toContain('Next.js');

    const real = detectTechStack('<script>window.__NEXT_DATA__ = {}</script>');
    expect(real.frameworks).toContain('Next.js');
  });

  it('does not co-detect Vue + Angular on a WordPress site (the failure mode)', () => {
    const html = `
      <html><body>
        <link rel="stylesheet" href="/wp-content/themes/acme/style.css">
        <p>We have a triangular logo with a vue from the top.</p>
      </body></html>
    `;
    const stack = detectTechStack(html);
    expect(stack.frameworks).not.toContain('Vue');
    expect(stack.frameworks).not.toContain('Angular');
  });
});
