---
mode: 'agent'
tools: ['read_file', 'insert_edit_into_file', 'replace_string_in_file', 'file_search', 'list_dir']
description: 'Generate a high-level design (HLD) document for a software project based on the provided requirements and architecture.'
---

Explore the entire repository to understand the codebase from multiple angles: as a software architect, software developer and product manager. I want you to compile your findings into a very extensive Markdown document in this folder: ${input:docsFolder:"./docs"} . For describing technical concepts, you should include Mermaid diagrams in this Markdown file.