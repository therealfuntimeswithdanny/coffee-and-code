export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function storyAuthor(story) {
  return story.author?.displayName || story.author?.handle || 'Coffee & Code';
}
