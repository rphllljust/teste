'use client';
import EnterpriseOperationsWorkbench from './EnterpriseOperationsWorkbench';
type Props={onOpenOrder:(id:string)=>void;onNavigate:(name:string)=>void};

/** Field Service and central operations now share the same authorized list
 * report, server-filtered exceptions, document inspector and drill-down.
 * No separate client-side KPI formula can drift from the PostgreSQL source.
 */
export default function FieldServiceCockpit({onOpenOrder,onNavigate}:Props){
 return <EnterpriseOperationsWorkbench mode="field" onOpenOrder={onOpenOrder} navigate={onNavigate}/>;
}
