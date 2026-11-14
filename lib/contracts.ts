export type AvailableCommand={id:string;label:string;primary:boolean;expectedVersion:number;requiredInputs:string[];refreshPolicy:string[]};
export type PageInfo={page:number;limit:number;offset:number;total:number;sourceTotal:number;hasMore:boolean};
export type Metric={metricId:string;value:number|string|null;authority:string;generatedAt:string;drilldown:{viewKey:string;filters:Record<string,string>};status:'available'|'unknown'};
export type BusinessContext={type:'ServiceOrder';id:string;displayRef?:string};
export type ViewDefinition={schemaVersion:1;entityKey:'serviceOrder';viewKey:'serviceOrders.worklist';filters:{query:string;category:string;view:string};sort:'createdAt.desc'|'createdAt.asc'|'title.asc'|'dueDate.asc';visibleColumns:string[];pageSize:10|25|50|100};
