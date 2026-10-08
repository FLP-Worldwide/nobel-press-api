import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import { accessErrorResponse, isEditableBookStatus } from '../utils/bookAccess';
import { validateCoverDesign, coverMatchesTrim } from '../utils/coverDesign';

export async function saveCoverDesign(req:AuthRequest,res:Response){
  const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({message:'Invalid book id'});
  if(!req.userId)return res.status(401).json({message:'Unauthorized'});
  let design;try{design=validateCoverDesign(req.body?.design);}catch(error){return res.status(400).json({message:(error as Error).message});}
  if(typeof req.body.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(req.body.expectedUpdatedAt)))return res.status(400).json({message:'Reload the book before saving the cover.'});
  try{
    const book=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM Book WHERE id = ${id} FOR UPDATE`;
      const current=await tx.book.findFirst({where:{id,deletedAt:null},include:{design:true}});
      if(!current)throw Error('NOT_FOUND');if(current.userId!==req.userId)throw Error('FORBIDDEN');if(!isEditableBookStatus(current.status))throw Error('BOOK_LOCKED');
      if(!coverMatchesTrim(design,current.design))throw Error('COVER_SIZE');
      if(current.updatedAt.toISOString()!==new Date(req.body.expectedUpdatedAt).toISOString())throw Error('CONFLICT');
      return tx.book.update({where:{id},data:{coverDesign:design},select:{id:true,updatedAt:true}});
    });
    return res.json({...book,message:'Covers saved'});
  }catch(error){const access=accessErrorResponse(error);if(access)return res.status(access.status).json({message:access.message});if((error as Error).message==='COVER_SIZE')return res.status(409).json({message:'The book page size changed. Download your artwork, then reopen the designer to fit the new size.'});if((error as Error).message==='CONFLICT')return res.status(409).json({message:'This book changed in another tab. Download your artwork to keep a copy, then reload before saving.'});console.error('saveCoverDesign',error);return res.status(500).json({message:'Could not save the cover. Your changes are still on this screen.'});}
}
