#!/usr/bin/env python3
"""
金蝶AI套件 R202605 资料转换工具
将Excel文件转换为适合模型向量检索的JSON格式
"""

import pandas as pd
import json
import os
from datetime import datetime

def read_excel_sheets(file_path):
    """读取Excel文件的所有工作表"""
    try:
        sheets = pd.read_excel(file_path, sheet_name=None, header=None)
        result = {}
        for sheet_name, df in sheets.items():
            result[sheet_name] = df
        return result
    except Exception as e:
        print(f"读取文件失败 {file_path}: {e}")
        return {}

def clean_dataframe(df):
    """清理DataFrame，处理合并单元格和空值"""
    # 填充前向值（处理合并单元格）
    df = df.ffill()
    # 替换空字符串为NaN
    df = df.replace('', pd.NA)
    return df

def extract_structured_data(sheet_name, df):
    """从DataFrame中提取结构化数据"""
    records = []
    
    # 检测是否有表头行（通常第一行或第二行包含列名）
    header_row = None
    for i in range(min(5, len(df))):
        row = df.iloc[i]
        # 如果一行中有很多非空值，且包含关键词，可能是表头
        non_null = row.dropna()
        if len(non_null) > 2:
            header_keywords = ['名称', '类型', '说明', '介绍', '功能', '接口', '银行', '税种']
            if any(any(kw in str(v) for kw in header_keywords) for v in non_null if pd.notna(v)):
                header_row = i
                break
    
    if header_row is not None:
        # 使用检测到的表头
        df_clean = df.copy()
        df_clean.columns = df_clean.iloc[header_row]
        df_clean = df_clean[header_row + 1:]
        df_clean = df_clean.dropna(how='all')
        df_clean = df_clean.reset_index(drop=True)
    else:
        df_clean = df.copy()
    
    # 转换为记录列表
    for idx, row in df_clean.iterrows():
        record = {}
        for col_idx, (col_name, value) in enumerate(row.items()):
            if pd.notna(value) and str(value).strip():
                col_name_clean = str(col_name).strip() if pd.notna(col_name) else f"column_{col_idx}"
                record[col_name_clean] = str(value).strip()
        
        if record:  # 只保存非空记录
            records.append(record)
    
    return records

def create_document_for_embedding(file_name, sheet_name, record, record_idx):
    """为向量检索创建文档片段"""
    # 构建结构化文本
    parts = []
    
    # 文件和工作表信息
    parts.append(f"【来源】{file_name} - {sheet_name}")
    
    # 添加记录内容
    for key, value in record.items():
        if value and value != 'NaN':
            parts.append(f"{key}: {value}")
    
    # 创建文档
    document = {
        "id": f"{file_name}_{sheet_name}_{record_idx}",
        "source_file": file_name,
        "source_sheet": sheet_name,
        "content": " | ".join(parts),
        "metadata": {
            "file_name": file_name,
            "sheet_name": sheet_name,
            "record_index": record_idx,
            "fields_count": len(record),
            "indexed_at": datetime.now().isoformat()
        },
        "structured_data": record
    }
    
    return document

def convert_to_chunks(file_name, sheet_name, records):
    """将记录转换为适合嵌入的文本块"""
    chunks = []
    
    for idx, record in enumerate(records):
        # 创建不同粒度的文本块
        # 1. 完整记录块
        full_text_parts = []
        for key, value in record.items():
            if value and value != 'NaN':
                full_text_parts.append(f"{key}: {value}")
        
        if full_text_parts:
            chunks.append({
                "chunk_id": f"{file_name}_{sheet_name}_{idx}_full",
                "chunk_type": "full_record",
                "text": " | ".join(full_text_parts),
                "metadata": {
                    "file": file_name,
                    "sheet": sheet_name,
                    "record_idx": idx,
                    "fields": list(record.keys())
                }
            })
        
        # 2. 字段级块（每个重要字段单独成块）
        for key, value in record.items():
            if value and value != 'NaN' and len(str(value)) > 5:  # 只处理有意义的值
                chunks.append({
                    "chunk_id": f"{file_name}_{sheet_name}_{idx}_{key}",
                    "chunk_type": "field_level",
                    "text": f"{key}: {value}",
                    "metadata": {
                        "file": file_name,
                        "sheet": sheet_name,
                        "record_idx": idx,
                        "field_name": key
                    }
                })
    
    return chunks

def process_all_files(base_dir):
    """处理所有文件"""
    all_documents = []
    all_chunks = []
    
    files = [
        "附件一：《金蝶AI套件R20605 SKU依赖关系和报价说明及产品介绍》.xlsx",
        "附件二：《金蝶AI套件 R202605银企云对接清单》.xlsx",
        "附件三：《金蝶AI套件 R202605税企直连对接清单》.xls"
    ]
    
    for file_name in files:
        file_path = os.path.join(base_dir, file_name)
        if not os.path.exists(file_path):
            print(f"文件不存在: {file_path}")
            continue
        
        print(f"\n{'='*80}")
        print(f"处理文件: {file_name}")
        print(f"{'='*80}")
        
        sheets = read_excel_sheets(file_path)
        
        for sheet_name, df in sheets.items():
            print(f"\n  工作表: {sheet_name}")
            print(f"  原始行数: {len(df)}")
            
            # 清理数据
            df_clean = clean_dataframe(df)
            
            # 提取结构化数据
            records = extract_structured_data(sheet_name, df_clean)
            print(f"  提取记录数: {len(records)}")
            
            # 创建文档
            for idx, record in enumerate(records):
                doc = create_document_for_embedding(file_name, sheet_name, record, idx)
                all_documents.append(doc)
            
            # 创建文本块
            chunks = convert_to_chunks(file_name, sheet_name, records)
            all_chunks.extend(chunks)
    
    return all_documents, all_chunks

def create_summary(documents, chunks):
    """创建数据摘要"""
    summary = {
        "total_documents": len(documents),
        "total_chunks": len(chunks),
        "files_processed": list(set(d["source_file"] for d in documents)),
        "sheets_processed": list(set(d["source_sheet"] for d in documents)),
        "chunk_types": {},
        "fields_distribution": {}
    }
    
    # 统计块类型
    for chunk in chunks:
        chunk_type = chunk["chunk_type"]
        summary["chunk_types"][chunk_type] = summary["chunk_types"].get(chunk_type, 0) + 1
    
    # 统计字段分布
    for doc in documents:
        for field in doc["structured_data"].keys():
            summary["fields_distribution"][field] = summary["fields_distribution"].get(field, 0) + 1
    
    return summary

def main():
    base_dir = "/Users/kevin/Downloads/附件二：《金蝶AI套件 R202605套件介绍》"
    output_dir = "/Users/kevin/AI/Workload-evaluation-system-agent/data/kingdee-ai-suite"
    
    os.makedirs(output_dir, exist_ok=True)
    
    print("开始转换金蝶AI套件资料...")
    print(f"源目录: {base_dir}")
    print(f"输出目录: {output_dir}")
    
    # 处理所有文件
    documents, chunks = process_all_files(base_dir)
    
    # 创建摘要
    summary = create_summary(documents, chunks)
    
    # 保存结果
    # 1. 完整文档（适合直接检索）
    documents_file = os.path.join(output_dir, "documents.json")
    with open(documents_file, 'w', encoding='utf-8') as f:
        json.dump(documents, f, ensure_ascii=False, indent=2)
    print(f"\n保存文档: {documents_file} ({len(documents)} 条)")
    
    # 2. 文本块（适合向量嵌入）
    chunks_file = os.path.join(output_dir, "chunks.json")
    with open(chunks_file, 'w', encoding='utf-8') as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)
    print(f"保存文本块: {chunks_file} ({len(chunks)} 条)")
    
    # 3. 摘要信息
    summary_file = os.path.join(output_dir, "summary.json")
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"保存摘要: {summary_file}")
    
    # 4. 创建易读的Markdown版本
    markdown_file = os.path.join(output_dir, "README.md")
    with open(markdown_file, 'w', encoding='utf-8') as f:
        f.write("# 金蝶AI套件 R202605 资料库\n\n")
        f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        
        f.write("## 数据概览\n\n")
        f.write(f"- 文档总数: {summary['total_documents']}\n")
        f.write(f"- 文本块总数: {summary['total_chunks']}\n")
        f.write(f"- 处理文件数: {len(summary['files_processed'])}\n")
        f.write(f"- 工作表总数: {len(summary['sheets_processed'])}\n\n")
        
        f.write("## 文件清单\n\n")
        for file in summary['files_processed']:
            f.write(f"- {file}\n")
        f.write("\n")
        
        f.write("## 工作表清单\n\n")
        for sheet in summary['sheets_processed']:
            f.write(f"- {sheet}\n")
        f.write("\n")
        
        f.write("## 字段分布（Top 20）\n\n")
        sorted_fields = sorted(summary['fields_distribution'].items(), key=lambda x: x[1], reverse=True)[:20]
        for field, count in sorted_fields:
            f.write(f"- {field}: {count} 次\n")
    
    print(f"保存说明: {markdown_file}")
    
    # 打印统计信息
    print("\n" + "="*80)
    print("转换完成！统计信息:")
    print("="*80)
    print(f"文档总数: {summary['total_documents']}")
    print(f"文本块总数: {summary['total_chunks']}")
    print(f"块类型分布: {summary['chunk_types']}")
    print(f"处理文件: {len(summary['files_processed'])}")
    print(f"处理工作表: {len(summary['sheets_processed'])}")

if __name__ == "__main__":
    main()
