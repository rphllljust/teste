# NextCRM — upstream isolado

O caminho integrations/nextcrm-upstream é um Git submodule que aponta para o projeto NextCRM completo; ele não é executado automaticamente pelo ERP.

Clone completo: git clone --recurse-submodules --branch integration/nextcrm-isolated-20261115 https://github.com/rphllljust/teste.git

Se já tiver clonado: git submodule update --init --recursive integrations/nextcrm-upstream

Não fazer migrações, seeds ou uploads para o banco do ERP. Consultar docs/integrations/nextcrm-isolated-adoption.md.