#!/usr/bin/env python3
"""Writes the blank .docx, .xlsx and .pptx that Office → New starts from when the server cannot create one.

Minimal, standard OOXML packages (ECMA-376), written by hand so nothing third-party is shipped. Run it again
after changing it: python3 scripts/make-blank-office.py
"""
import os, zipfile

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'modules', 'office', 'blank')
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def write(name, parts):
    path = os.path.join(OUT, name)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml first, as Office writes it.
        for part in ['[Content_Types].xml'] + [p for p in parts if p != '[Content_Types].xml']:
            info = zipfile.ZipInfo(part, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, X + parts[part])
    print(name, os.path.getsize(path))


def rels(*items):
    return f'<Relationships xmlns="{PR}">' + ''.join(f'<Relationship Id="{i}" Type="{t}" Target="{g}"/>' for i, t, g in items) + '</Relationships>'


# ── Word ─────────────────────────────────────────────────────────────────
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
write('blank.docx', {
    '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': rels(('rId1', f'{R}/officeDocument', 'word/document.xml')),
    'word/_rels/document.xml.rels': rels(('rId1', f'{R}/styles', 'styles.xml')),
    'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style></w:styles>',
    'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>',
})

# ── Excel ────────────────────────────────────────────────────────────────
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
write('blank.xlsx', {
    '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': rels(('rId1', f'{R}/officeDocument', 'xl/workbook.xml')),
    'xl/_rels/workbook.xml.rels': rels(('rId1', f'{R}/worksheet', 'worksheets/sheet1.xml'), ('rId2', f'{R}/styles', 'styles.xml')),
    'xl/workbook.xml': f'<workbook xmlns="{S}" xmlns:r="{R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/styles.xml': f'<styleSheet xmlns="{S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{S}" xmlns:r="{R}"><sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>',
})

# ── PowerPoint ───────────────────────────────────────────────────────────
def sp(id, name, ph, text_body=True):
    body = f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-GB"/></a:p></p:txBody>' if text_body else ''
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr/>{body}</p:sp>'

def tree(shapes):
    return f'<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{shapes}</p:spTree></p:cSld>'

def xfrm_sp(id, name, ph, x, y, cx, cy, size, bold=False):
    b = ' b="0"' if not bold else ' b="1"'
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
            f'<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-GB" sz="{size}"{b}/></a:p></p:txBody></p:sp>')

NS = f'xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}"'
fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
ln = '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
theme = (f'<a:theme xmlns:a="{A}" name="Office Theme"><a:themeElements>'
         '<a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>'
         '<a:accent1><a:srgbClr val="3B5BDB"/></a:accent1><a:accent2><a:srgbClr val="0CA678"/></a:accent2><a:accent3><a:srgbClr val="F08C00"/></a:accent3><a:accent4><a:srgbClr val="E03131"/></a:accent4><a:accent5><a:srgbClr val="7048E8"/></a:accent5><a:accent6><a:srgbClr val="1098AD"/></a:accent6>'
         '<a:hlink><a:srgbClr val="1C7ED6"/></a:hlink><a:folHlink><a:srgbClr val="862E9C"/></a:folHlink></a:clrScheme>'
         '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
         f'<a:fmtScheme name="Office"><a:fillStyleLst>{fill*3}</a:fillStyleLst><a:lnStyleLst>{ln*3}</a:lnStyleLst>'
         '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>' * 3 + f'</a:effectStyleLst><a:bgFillStyleLst>{fill*3}</a:bgFillStyleLst></a:fmtScheme>'
         '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>')
W16, H9 = 12192000, 6858000
title_ph = '<p:ph type="ctrTitle"/>'
sub_ph = '<p:ph type="subTitle" idx="1"/>'
write('blank.pptx', {
    '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                           '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
                           '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
                           '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
                           '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
                           '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>',
    '_rels/.rels': rels(('rId1', f'{R}/officeDocument', 'ppt/presentation.xml')),
    'ppt/_rels/presentation.xml.rels': rels(('rId1', f'{R}/slideMaster', 'slideMasters/slideMaster1.xml'), ('rId2', f'{R}/slide', 'slides/slide1.xml'), ('rId3', f'{R}/theme', 'theme/theme1.xml')),
    'ppt/presentation.xml': f'<p:presentation {NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="{W16}" cy="{H9}"/><p:notesSz cx="{H9}" cy="{W16}"/></p:presentation>',
    'ppt/theme/theme1.xml': theme,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels(('rId1', f'{R}/slideLayout', '../slideLayouts/slideLayout1.xml'), ('rId2', f'{R}/theme', '../theme/theme1.xml')),
    'ppt/slideMasters/slideMaster1.xml': (f'<p:sldMaster {NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
                                          + xfrm_sp(2, 'Title Placeholder 1', '<p:ph type="title"/>', 838200, 365125, 10515600, 1325563, 4400)
                                          + xfrm_sp(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', 838200, 1825625, 10515600, 4351338, 2800)
                                          + '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
                                          '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
                                          '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
                                          '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>'
                                          '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>'),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels(('rId1', f'{R}/slideMaster', '../slideMasters/slideMaster1.xml')),
    'ppt/slideLayouts/slideLayout1.xml': (f'<p:sldLayout {NS} type="title" preserve="1"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
                                          + xfrm_sp(2, 'Title 1', title_ph, 1524000, 1122363, 9144000, 2387600, 6000)
                                          + xfrm_sp(3, 'Subtitle 2', sub_ph, 1524000, 3602038, 9144000, 1655762, 2400)
                                          + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'),
    'ppt/slides/_rels/slide1.xml.rels': rels(('rId1', f'{R}/slideLayout', '../slideLayouts/slideLayout1.xml')),
    'ppt/slides/slide1.xml': f'<p:sld {NS}>' + tree(sp(2, 'Title 1', title_ph) + sp(3, 'Subtitle 2', sub_ph)) + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
})
