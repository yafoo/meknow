const Base = require('./base');
const {join} = require('path');
const {mkdir, writeFile} = require('fs').promises;
const crypto = require('crypto');

class Upload extends Base
{
    async index() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const files = this.ctx.request.files;
        if(!files || !files.file) return this.$error('请选择文件');

        const file = files.file;
        const now = new Date();
        const year = now.getFullYear();
        const monthDay = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
        
        const uploadDir = join(this.$config.app.base_dir, 'public', 'upload', String(year), monthDay);
        await mkdir(uploadDir, {recursive: true});
        
        const ext = file.originalFilename.split('.').pop();
        const filename = crypto.randomBytes(8).toString('hex') + '.' + ext;
        const filepath = join(uploadDir, filename);
        
        await writeFile(filepath, file.filepath);

        const relativePath = '/upload/' + year + '/' + monthDay + '/' + filename;
        
        // 保存上传记录
        const noteId = this.$request.post('note_id', 0);
        const attachId = await this.$db.table('attach').insert({
            note_id: noteId,
            filename: file.originalFilename,
            filepath: relativePath,
            filesize: file.size,
            filetype: ext,
            add_time: Math.floor(Date.now() / 1000)
        });

        this.$success('上传成功', {
            id: attachId,
            url: relativePath,
            filename: file.originalFilename,
            filesize: file.size
        });
    }
}

module.exports = Upload;
