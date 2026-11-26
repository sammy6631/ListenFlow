import { ListenDocument } from '../types';

export const SAMPLE_DOCUMENTS: Omit<ListenDocument, 'id' | 'createdAt' | 'lastOpenedAt'>[] = [
  {
    title: 'Welcome to ListenFlow — Quick Start Guide',
    author: 'ListenFlow',
    sourceType: 'text',
    wordCount: 165,
    estimatedMinutes: 1,
    currentParagraphIndex: 0,
    bookmarks: [],
    paragraphs: [
      'Welcome to ListenFlow, your personal neural text-to-speech reader. Every word you see on screen is read aloud with lifelike inflection and highlighted in real time so you can follow along effortlessly or listen hands-free.',
      'You can import virtually anything you want to read: drop in PDF reports, Microsoft Word documents, EPUB eBooks, Markdown notes, or plain text files. You can also paste any website link and ListenFlow will automatically strip away ads and clutter to read the clean article aloud.',
      'Want to listen to text that is already on your screen? Drag the ListenFlow bookmarklet to your browser bar to read any live webpage with one click, or paste a screenshot right into the app using Control V to extract and narrate text from images.',
      'Try clicking any paragraph to jump directly to it, adjust the playback speed up to three times normal pace, switch between over three hundred neural voices in sixty languages, or export your document as an MP3 audiobook.',
    ],
  },
  {
    title: 'The Power of Listening While Learning',
    author: 'Editorial Essay',
    sourceType: 'web',
    wordCount: 196,
    estimatedMinutes: 1,
    currentParagraphIndex: 0,
    bookmarks: [],
    paragraphs: [
      'For centuries, deep reading required sitting still with eyes fixed on paper or a glowing screen. Today, modern neural speech synthesis transforms reading into a flexible, eyes-free experience that fits naturally into walks, commutes, and everyday routines.',
      'Research in dual-coding theory shows that combining visual word tracking with clear spoken narration can improve comprehension and reduce eye fatigue. Readers with dyslexia, visual strain, or packed schedules often retain more information when they can both see and hear complex material.',
      'Unlike older robotic voices that flattened punctuation and cadence, modern neural voices breathe at commas, emphasize questions, and adapt smoothly to faster listening speeds. Many listeners comfortably settle into one point five to two times speed within a few days, finishing long articles and research papers in half the time.',
      'Whether you are reviewing a dense PDF before a meeting, catching up on long-form journalism, or studying a chapter from an eBook, turning text into natural audio unlocks hours of calm, focused productivity.',
    ],
  },
];
