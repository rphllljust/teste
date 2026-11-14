import {database} from '../../db/raw';
import {proposalAmounts,type ProposalData} from '../domain/proposals';
import {ApiError} from './http';
export function amounts(data:ProposalData){try{return proposalAmounts(data);}catch(e){throw new ApiError(400,'VALIDATION_FAILED',e instanceof Error?e.message:'Valores inválidos.');}}
export function proposalLines(id:string,data:ProposalData,key:string){return amounts(data).lines.map(line=>database().prepare('INSERT INTO proposal_lines(id,proposal_id,position,description,unit,quantity,unit_price,amount) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM business_commands WHERE id=? AND entity_id=?)').bind(crypto.randomUUID(),id,line.position,line.description,line.unit,line.quantity,line.unitPrice,line.amount,key,id));}
