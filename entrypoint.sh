#!/bin/sh -l

echo "looking for files with $1 suffix"
find . -regex ".*\.\($1\)"
