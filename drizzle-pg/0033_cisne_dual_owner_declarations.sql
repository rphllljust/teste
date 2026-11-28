-- Abrahim and Rafael: two equal declared owners of CISNE ERP, based on user instruction.
-- This registry is separate from login identities and does NOT grant ERP permissions.
CREATE TABLE cisne_erp_owner_declarations (
 owner_key text PRIMARY KEY CHECK (owner_key IN ('abrahim','rafael')),
 display_name text NOT NULL UNIQUE,
 declared_role text NOT NULL DEFAULT 'owner' CHECK (declared_role = 'owner'),
 identity_actor_id text UNIQUE,
 identity_state text NOT NULL DEFAULT 'unlinked' CHECK (identity_state IN ('unlinked','verified')),
 declared_source text NOT NULL DEFAULT 'user_explicit_declaration_2026_11_27',
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT cisne_erp_owner_name_matches_key CHECK (
  (owner_key = 'abrahim' AND display_name = 'Abrahim') OR
  (owner_key = 'rafael' AND display_name = 'Rafael')
 ),
 CONSTRAINT cisne_erp_owner_verified_identity CHECK (
  (identity_state = 'unlinked' AND identity_actor_id IS NULL) OR
  (identity_state = 'verified' AND identity_actor_id IS NOT NULL)
 )
);
--> statement-breakpoint
INSERT INTO cisne_erp_owner_declarations(owner_key,display_name,declared_role,identity_state)
VALUES ('abrahim','Abrahim','owner','unlinked'),
       ('rafael','Rafael','owner','unlinked');
