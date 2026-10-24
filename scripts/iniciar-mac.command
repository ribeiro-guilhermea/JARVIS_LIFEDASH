#!/bin/bash
# Duplo clique para abrir o Life Dashboard no Mac (na primeira vez: chmod +x scripts/iniciar-mac.command).
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js não encontrado. Instale a versão LTS em https://nodejs.org"; read; exit 1; }
(sleep 2; open http://localhost:4310) &
npm start
