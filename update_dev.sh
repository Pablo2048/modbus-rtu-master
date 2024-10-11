#!/bin/bash
git checkout development
git pull origin development
git merge main
git push origin development
