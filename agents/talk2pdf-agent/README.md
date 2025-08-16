# Talk2PDF Agent

A comprehensive AI agent for parsing and analyzing PDF documents using the [Talk2PDF MCP Server](https://github.com/truffle-ai/mcp-servers/tree/main/src/talk2pdf).

This agent provides intelligent PDF document processing through a TypeScript-based MCP server that can extract text, metadata, and search for specific content within PDF files.

## Features

### 📄 **PDF Parsing & Text Extraction**
- **Full Document Parsing**: Extract complete text content from PDF files
- **Metadata Extraction**: Get document information (title, author, page count, creation date)
- **Format Support**: Handle various PDF versions and structures
- **Error Handling**: Graceful handling of corrupted or protected PDFs

### 🔍 **Content Search & Analysis**
- **Section Extraction**: Search for and extract specific content sections
- **Intelligent Filtering**: Find content containing specific terms or patterns
- **Context Preservation**: Maintain document structure and formatting
- **Multi-page Support**: Process documents of any length

### 🧠 **AI-Powered Analysis**
- **Document Summarization**: Generate intelligent summaries of PDF content
- **Key Information Extraction**: Identify and extract important details
- **Question Answering**: Answer questions about document content
- **Content Classification**: Analyze document type and structure

## Quick Start

### Prerequisites
- **Node.js 20+**: For the Dexto framework
- **TypeScript**: Automatically managed by the MCP server

### Installation

1. **Run the Agent**:
   ```bash
   # From the dexto project root
   dexto --agent agents/talk2pdf-agent/talk2pdf-agent.yml
   ```

That's it! The MCP server will be automatically downloaded and installed via `npx` on first run.

## Configuration

The agent is configured to use the published MCP server:

```yaml
mcpServers:
  talk2pdf:
    type: stdio
    command: npx
    args:
      - "@truffle-ai/talk2pdf-mcp"
    timeout: 30000
    connectionMode: strict
```

## MCP Server

This agent uses the **Talk2PDF MCP Server**, which is maintained separately at:

**🔗 [https://github.com/truffle-ai/mcp-servers/tree/main/src/talk2pdf](https://github.com/truffle-ai/mcp-servers/tree/main/src/talk2pdf)**

The MCP server repository provides:
- Complete technical documentation
- Development and contribution guidelines  
- Server implementation details
- Advanced configuration options

## Available Tools

### PDF Processing Tools

#### `parse_pdf`
Extract complete text content and metadata from a PDF file.

**Parameters:**
- `filePath` (string): Path to the PDF file to parse

**Returns:**
- Full text content of the document
- Document metadata (title, author, page count, creation date, etc.)
- File information (size, format)

#### `extract_section`
Search for and extract specific content sections from a PDF.

**Parameters:**
- `filePath` (string): Path to the PDF file
- `searchTerms` (string): Terms or patterns to search for
- `maxResults` (number, optional): Maximum number of results to return

**Returns:**
- Matching content sections with context
- Page numbers and locations
- Relevance scoring

## Supported PDF Features

- **Standard PDF formats**: PDF 1.4 through 2.0
- **Text-based PDFs**: Documents with extractable text content
- **Multi-page documents**: No page limit restrictions
- **Metadata support**: Title, author, creation date, modification date
- **Various encodings**: UTF-8, Latin-1, and other standard encodings

## Example Usage

### Basic PDF Parsing
```
"Parse the PDF at /path/to/document.pdf and show me the full content"
"Extract all text and metadata from my research paper"
"What's in this PDF file?"
```

### Content Search
```
"Find all sections about 'machine learning' in the PDF"
"Extract the introduction and conclusion from this document" 
"Search for mentions of 'budget' in the financial report"
```

### Document Analysis
```
"Summarize the main points from this PDF"
"What is this document about?"
"Extract the key findings from the research paper"
"List all the recommendations mentioned in the report"
```

### Intelligent Q&A
```
"What are the main conclusions of this study?"
"Who are the authors of this document?"
"When was this document created?"
"How many pages does this PDF have?"
```

## Troubleshooting

### Common Issues

1. **Server Installation**: The MCP server will be automatically installed via `npx` on first run. No manual setup required.

2. **PDF Access Issues**: Ensure the PDF file path is correct and the file is readable. Protected or encrypted PDFs may require special handling.

3. **Memory Issues**: For very large PDFs (100+ pages), processing may take longer. Consider breaking large documents into sections.

4. **Text Extraction**: If text appears garbled, the PDF may use non-standard encoding or be scanned image-based (OCR not supported).

### Error Handling

The agent provides clear error messages for common issues:
- File not found or inaccessible
- Invalid PDF format
- Corrupted PDF files
- Permission-protected documents

## Getting Help

- **MCP Server Issues**: Report at the [mcp-servers repository](https://github.com/truffle-ai/mcp-servers/issues)
- **Agent Configuration**: Report at the main Dexto repository
- **Feature Requests**: Use the mcp-servers repository for tool-related requests

## License

This project is part of the Dexto AI agent framework.