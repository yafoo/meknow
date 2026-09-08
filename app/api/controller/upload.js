const Base = require('./base');
const {join} = require('path');

class Upload extends Base
{
    async index() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        // 框架 $upload.save() 内部自动生成 YYYY/mmdd/ 子目录和 md5 文件名
        const uploadDir = join(this.$config.app.static_dir, 'upload');
        const result = await this.$upload.file('file').validate({size: 10 * 1024 * 1024}).save(uploadDir);

        if(typeof result === 'object') {
            const relativePath = '/upload/' + result.savename;

            // 保存上传记录
            const noteId = this.$request.post('note_id', 0);
            const attachId = await this.$db.table('attach').insert({
                note_id: noteId,
                filename: result.name,
                filepath: relativePath,
                filesize: result.size,
                filetype: result.extname,
                add_time: Math.floor(Date.now() / 1000)
            });

            this.$success('上传成功', {
                id: attachId.insertId || attachId,
                url: relativePath,
                filename: result.name,
                filesize: result.size
            });
        } else {
            this.$error(this.$upload.getError());
        }
    }
}

module.exports = Upload;
