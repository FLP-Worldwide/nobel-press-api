import { Response } from 'express';
import { createHash } from 'crypto';
import sanitizeHtml from 'sanitize-html';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import { accessErrorResponse, isEditableBookStatus } from '../utils/bookAccess';

const MAX_BYTES = 3 * 1024 * 1024;
const types = new Set(['chapter', 'intro', 'preface', 'section']);
function cleanContent(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ['p','div','br','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','strike','blockquote','ul','ol','li','hr','a','sup','sub','img','table','thead','tbody','tfoot','tr','th','td','caption'],
    allowedAttributes: { '*': ['id','data-page-break','data-continuation','style'], a: ['href'], img: ['src','alt'], ol: ['start'], td: ['colspan','rowspan'], th: ['colspan','rowspan'] },
    allowedSchemes: ['http','https','mailto'], allowedSchemesByTag: { img: ['data'] }, allowProtocolRelative: false,
    allowedStyles: { '*': { 'text-align': [/^(left|right|center|justify)$/], 'font-style': [/^(normal|italic)$/], 'font-weight': [/^(normal|bold|[1-9]00)$/], 'text-decoration': [/^(underline|line-through)$/] } },
    exclusiveFilter: frame => frame.tag === 'img' && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(frame.attribs.src || '') || frame.attribs.src.length > 1500000),
  });
}
export const importManuscript = async (req: AuthRequest, res: Response) => {
  const bookId = Number(req.params.id);
  if (!Number.isInteger(bookId) || bookId < 1) return res.status(400).json({ message: 'Choose a valid book.' });
  if (!req.userId) return res.status(401).json({ message: 'Please sign in again.' });
  const { sections: input, importKey, expectedUpdatedAt } = req.body || {};
  if (typeof importKey !== 'string' || !/^[a-z0-9_.:-]{8,80}$/i.test(importKey) || !Array.isArray(input) || !input.length || input.length > 500 || typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) return res.status(400).json({ message: 'Select between 1 and 500 sections and reopen the book before importing.', code: 'INVALID_IMPORT' });
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_BYTES) return res.status(413).json({ message: 'Import up to 3 MB of converted content at a time. Split this Word file into smaller documents.' });
  if (input.some(item => !item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200 || typeof item.content !== 'string' || !types.has(item.type))) return res.status(400).json({ message: 'Every imported section needs a title, text and a supported section type.', code: 'INVALID_IMPORT' });
  const sections = input.map(item => ({ title: item.title.trim(), type: item.type, content: cleanContent(item.content) }));
  if (sections.some(item => !item.content.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g,'') && !/<img\b/.test(item.content))) return res.status(422).json({ message: 'Remove empty sections before importing.', code: 'EMPTY_IMPORT_SECTION' });
  const hash = createHash('sha256').update(JSON.stringify(sections)).digest('hex');
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Book" WHERE id = ${bookId} FOR UPDATE`;
      const book = await tx.book.findFirst({ where: { id: bookId, deletedAt: null }, select: { id: true, userId: true, status: true, updatedAt: true } });
      if (!book) throw Error('NOT_FOUND');
      if (book.userId !== req.userId) throw Error('FORBIDDEN');
      const previous = await tx.bookChapter.findMany({ where: { bookId, creationKey: { startsWith: `${importKey}:` } }, orderBy: { position: 'asc' }, select: { id: true, title: true, type: true, position: true, creationHash: true } });
      if (previous.length) {
        if (previous.length !== sections.length || previous.some(chapter => chapter.creationHash !== hash)) throw Error('IMPORT_KEY_REUSED');
        return { importedCount: previous.length, chapters: previous, updatedAt: book.updatedAt, alreadyImported: true };
      }
      if (!isEditableBookStatus(book.status)) throw Error('BOOK_LOCKED');
      if (book.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw Error('BOOK_CHANGED');
      const last = await tx.bookChapter.aggregate({ where: { bookId }, _max: { position: true } });
      const firstPosition = (last._max.position ?? -1) + 1;
      await tx.bookChapter.createMany({ data: sections.map((section, index) => ({ ...section, bookId, position: firstPosition + index, creationKey: `${importKey}:${index}`, creationHash: hash })) });
      const updated = await tx.book.update({ where: { id: bookId }, data: { updatedAt: new Date() }, select: { updatedAt: true } });
      const chapters = await tx.bookChapter.findMany({ where: { bookId, creationKey: { startsWith: `${importKey}:` } }, orderBy: { position: 'asc' }, select: { id: true, title: true, type: true, position: true } });
      return { importedCount: chapters.length, chapters, updatedAt: updated.updatedAt, alreadyImported: false };
    }, { maxWait: 5000, timeout: 15000 });
    return res.status(201).json(result);
  } catch (error: any) {
    const access = accessErrorResponse(error);
    if (access) return res.status(access.status).json({ ...access, code: error.message });
    if (error.message === 'BOOK_CHANGED') return res.status(409).json({ message: 'This book changed in another tab. Refresh the book details, check your selected sections and import again.', code: 'BOOK_CHANGED' });
    if (error.message === 'IMPORT_KEY_REUSED') return res.status(409).json({ message: 'This upload was already used for different sections. Choose the file again to start another import.', code: 'IMPORT_KEY_REUSED' });
    console.error('manuscript import failed', { bookId, code: error?.code || 'UNKNOWN' });
    return res.status(503).json({ message: 'We couldn’t confirm the import. Your existing writing is safe. Keep this page open and try again to check the same upload.', code: 'IMPORT_UNAVAILABLE', retryable: true });
  }
};
