export const isValidProjectLink = (link) => {
  if (typeof link !== "string" || !link.trim()) return false;

  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
