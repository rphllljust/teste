import {z} from 'zod';
import {validDate} from '../api/http';
export const resourceKinds=['production','equipment','vehicle','labor','fuel'] as const;
export const executionLabels:Record<string,string>={production:'Produção',equipment:'Equipamento',vehicle:'Veículo',labor:'Mão de obra',fuel:'Combustível'};
export const executionStages=['field_work','travel','pause','inspection','handover'] as const;
export const executionStageLabels:Record<string,string>={field_work:'Trabalho em campo',travel:'Deslocamento',pause:'Pausa',inspection:'Inspeção',handover:'Entrega/aceite'};
const optionalDateTime=z.string().trim().max(40).optional().nullable();
export const executionInput=z.discriminatedUnion('command',[z.object({command:z.literal('report'),key:z.string().uuid(),version:z.number().int().positive(),resourceKind:z.enum(resourceKinds),stage:z.enum(executionStages).default('field_work'),responsiblePersonId:z.string().uuid().nullable(),description:z.string().trim().min(3).max(1000),quantity:z.string().regex(/^\d+(?:[,.]\d{1,6})?$/).max(24),unit:z.string().trim().min(1).max(20),resourceReference:z.string().trim().min(3).max(160).nullable(),effectiveDate:z.string().refine(validDate),startedAt:optionalDateTime,endedAt:optionalDateTime,notes:z.string().trim().max(2000).optional().nullable(),reference:z.string().trim().min(3).max(160)}).strict(),z.object({command:z.literal('void'),key:z.string().uuid(),version:z.number().int().positive(),reversesId:z.string().uuid(),reason:z.string().trim().min(3).max(160)}).strict()]);
export function quantityScaled(value:string){const [whole,fraction='']=value.replace(',','.').split('.'),n=BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,'0'));if(n<=BigInt(0)||n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Quantidade fora do limite suportado.');return Number(n);}
export function executionQuantity(value:string){const n=BigInt(value),base=BigInt(1000000);return `${n/base},${String(n%base).padStart(6,'0')}`;}
