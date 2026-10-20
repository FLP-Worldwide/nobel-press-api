import { RequestParamHandler } from 'express';
import prisma from '../utils/prisma';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Resolve the public random reference once. Each controller still performs its
// normal ownership/role/status checks; an opaque URL is never authorization.
export const resolveBookReference: RequestParamHandler = async (req,res,next,value,name) => {
  if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) return next(); // Legacy API clients.
  if (!UUID.test(value)) return res.status(404).json({message:'Book not found'});
  try {
    const book = await prisma.book.findUnique({where:{publicId:value},select:{id:true}});
    if (!book) return res.status(404).json({message:'Book not found'});
    req.params[name]=String(book.id); next();
  } catch { return res.status(503).json({message:'Your book could not be opened right now. Please try again.'}); }
};
