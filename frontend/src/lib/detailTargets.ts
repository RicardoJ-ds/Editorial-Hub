const RING_CLASSES = [
  "ring-2",
  "ring-[#42CA80]/60",
  "ring-offset-2",
  "ring-offset-black",
  "transition-shadow",
] as const;

const OUTLINE_CLASSES = [
  "outline",
  "outline-2",
  "outline-[#42CA80]/50",
  "outline-offset-4",
  "rounded",
  "transition-all",
] as const;

const FLASH_TIMEOUT_MS = 1600;
const FLASH_TIMEOUT_KEY = "detailFlashTimeoutId";

export function slugifyPodLabel(pod: string): string {
  return pod.replace(/\s+/g, "-").toLowerCase();
}

function openRelatedDetails(target: HTMLElement) {
  if (target instanceof HTMLDetailsElement) target.open = true;

  const childDetails = target.querySelector("details");
  if (childDetails instanceof HTMLDetailsElement) childDetails.open = true;

  let parent = target.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
}

function flashTarget(
  target: HTMLElement,
  kind: "ring" | "outline",
) {
  const classes = kind === "outline" ? OUTLINE_CLASSES : RING_CLASSES;
  const oldTimeout = Number(target.dataset[FLASH_TIMEOUT_KEY] ?? "0");
  if (oldTimeout) window.clearTimeout(oldTimeout);

  target.classList.add(...classes);
  const timeoutId = window.setTimeout(() => {
    target.classList.remove(...classes);
    delete target.dataset[FLASH_TIMEOUT_KEY];
  }, FLASH_TIMEOUT_MS);
  target.dataset[FLASH_TIMEOUT_KEY] = String(timeoutId);
}

export function revealDetailTarget(
  targetId: string,
  kind: "ring" | "outline" = targetId.includes("-pod-") ? "outline" : "ring",
): boolean {
  if (typeof document === "undefined") return false;
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLElement)) return false;

  openRelatedDetails(target);
  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    flashTarget(target, kind);
  });
  return true;
}

export function revealCurrentHashTarget(prefixes: string[]): boolean {
  if (typeof window === "undefined") return false;
  const targetId = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
  if (!targetId) return false;
  if (!prefixes.some((prefix) => targetId.startsWith(prefix))) return false;
  return revealDetailTarget(targetId);
}
