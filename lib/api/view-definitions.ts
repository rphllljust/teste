import {z} from 'zod';
import {categories,viewNames,sortKeys} from './query';
import {validDate} from './http';

const pageSize=z.union([z.literal(10),z.literal(25),z.literal(50),z.literal(100)]);
const unique=<T extends string>(values:T[])=>new Set(values).size===values.length;
export const orderDefinition=z.object({
 schemaVersion:z.literal(1),entityKey:z.literal('serviceOrder'),viewKey:z.literal('serviceOrders.worklist'),
 filters:z.object({query:z.string().trim().max(160),category:z.enum(categories),view:z.enum(viewNames)}).strict(),
 sort:z.enum(sortKeys),visibleColumns:z.array(z.enum(['order','client','status','dueDate','nextAction'])).min(1).max(5).refine(unique),pageSize,
}).strict();
const date=z.string().refine(validDate);
const financeKeys={measurement:'operation.measurements',invoice:'operation.invoices',receivable:'operation.receivables'} as const;
export const financialDefinition=z.object({
 schemaVersion:z.literal(2),entityKey:z.enum(['measurement','invoice','receivable']),viewKey:z.enum(['operation.measurements','operation.invoices','operation.receivables']),
 filters:z.object({q:z.string().trim().max(160),orderId:z.string().uuid().optional(),status:z.enum(['draft','approved','billed']).optional(),settlementState:z.enum(['open','partial','settled','outstanding']).optional(),dueFrom:date.optional(),dueTo:date.optional()}).strict(),
 sort:z.enum(sortKeys),visibleColumns:z.array(z.enum(['origin','description','principal','state','nextAction'])).min(1).max(5).refine(unique),pageSize,
}).strict().refine(d=>financeKeys[d.entityKey]===d.viewKey).refine(d=>!d.filters.status||d.entityKey==='measurement').refine(d=>!d.filters.settlementState||d.entityKey==='receivable').refine(d=>!d.filters.dueFrom||!d.filters.dueTo||d.filters.dueFrom<=d.filters.dueTo);
export const payableDefinition=z.object({schemaVersion:z.literal(3),entityKey:z.literal('payable'),viewKey:z.literal('payables.worklist'),filters:z.object({q:z.string().trim().max(160),state:z.enum(['open','partial','settled','outstanding']).optional(),dueFrom:date.optional(),dueTo:date.optional()}).strict(),sort:z.enum(['createdAt.desc','createdAt.asc','dueDate.asc']),visibleColumns:z.array(z.enum(['supplier','source','principal','outstanding','dueDate','state'])).min(1).max(6).refine(unique),pageSize}).strict().refine(d=>!d.filters.dueFrom||!d.filters.dueTo||d.filters.dueFrom<=d.filters.dueTo);
export const savedViewDefinition=z.union([orderDefinition,financialDefinition,payableDefinition]);
export const viewKey=z.enum(['serviceOrders.worklist','operation.measurements','operation.invoices','operation.receivables','payables.worklist']);
export type FinancialDefinition=z.infer<typeof financialDefinition>;
