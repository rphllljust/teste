import { redirect } from 'next/navigation';

/** Legacy path: governance is now opened within the ERP's native shell. */
export default function LegacyEnterpriseGovernanceRoute() {
  redirect('/#Governan%C3%A7a%20empresarial');
}
