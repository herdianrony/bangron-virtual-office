/**
 * Accessibility Utilities - ARIA labels, focus trapping, color contrast helpers
 * WCAG 2.1 AA compliance helpers for Bangron Virtual Office
 */

export class Accessibility {
  /**
   * Trap focus inside a modal dialog
   */
  static trapFocus(modalElement) {
    const focusableElements = modalElement.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    modalElement.addEventListener('keydown', handleTab);
    if (firstEl) firstEl.focus();

    return () => {
      modalElement.removeEventListener('keydown', handleTab);
    };
  }

  /**
   * Add ARIA live region for announcements (screen readers)
   */
  static announce(message, priority = 'polite') {
    let region = document.getElementById('aria-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'aria-live-region';
      region.setAttribute('aria-live', priority);
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only fixed p-1';
      document.body.appendChild(region);
    }
    region.innerText = message;
    setTimeout(() => { region.innerText = ''; }, 1000);
  }

  /**
   * Ensure all interactive elements have accessible names
   */
  static auditInteractiveElements(container = document) {
    const issues = [];
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn, i) => {
      const text = btn.innerText.trim();
      const ariaLabel = btn.getAttribute('aria-label');
      const title = btn.getAttribute('title');
      const iconOnly = btn.querySelector('i, svg') && !text;
      if (iconOnly && !ariaLabel && !title) {
        issues.push({
          element: 'button',
          index: i,
          issue: 'Icon-only button missing aria-label or title',
          suggestion: 'Add aria-label describing the action'
        });
      }
    });

    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach((input, i) => {
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label');
      const hasAriaLabelledBy = input.getAttribute('aria-labelledby');
      const placeholder = input.getAttribute('placeholder');
      if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !placeholder) {
        issues.push({
          element: input.tagName.toLowerCase(),
          index: i,
          issue: 'Form input missing accessible name',
          suggestion: 'Add associated <label>, aria-label, or placeholder'
        });
      }
    });

    return issues;
  }

  /**
   * Skip to main content link
   */
  static injectSkipLink() {
    if (document.getElementById('skip-link')) return;
    const link = document.createElement('a');
    link.href = '#main-content';
    link.className = 'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-content focus:rounded';
    link.innerText = 'Langsung ke konten utama';
    document.body.insertBefore(link, document.body.firstChild);
  }

  /**
   * Reduce motion preference
   */
  static prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Announce status changes to screen readers
   */
  static announceStatus(status, message) {
    const region = document.getElementById('aria-status-region') || this.createStatusRegion();
    region.setAttribute('aria-live', status === 'error' ? 'assertive' : 'polite');
    region.innerText = message;
  }

  static createStatusRegion() {
    const region = document.createElement('div');
    region.id = 'aria-status-region';
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only fixed p-1';
    document.body.appendChild(region);
    return region;
  }
}

// Auto-inject skip link on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Accessibility.injectSkipLink());
  } else {
    Accessibility.injectSkipLink();
  }
}

export default Accessibility;