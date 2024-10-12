#!/bin/bash

# Zkontroluj, jestli existuje větev development na vzdáleném repozitáři
if git show-ref --quiet refs/heads/development; then
  git checkout development
else
  git checkout -b development origin/development
fi

git pull origin development

# Proveď merge z main
git merge main

# Pushni změny do vzdálené development větve
git push origin development
