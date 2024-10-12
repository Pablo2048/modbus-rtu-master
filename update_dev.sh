#!/bin/bash

# Stáhni všechny větve z origin
git fetch origin

# Přepni se na main a stáhni nejnovější změny
git checkout main
git pull origin main

# Zkontroluj, jestli existuje větev development lokálně, pokud ne, vytvoř ji
if git show-ref --quiet refs/heads/development; then
  git checkout development
else
  git checkout -b development origin/development
fi

# Stáhni nejnovější změny z development větve
git pull origin development

# Proveď merge z main do development s povolením nesouvisejících historií
git merge main --allow-unrelated-histories

# Pushni změny do vzdálené development větve
git push origin development
