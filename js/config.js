/**
 * 共享存储配置。
 *
 * ⚠️ 这里**只有不是秘密的东西**。
 *    owner / repo 写在公开仓库里无所谓——token 才是关键，
 *    而它不在这个文件里，由本人在自己手机上粘一次，存在那台设备上。
 *
 * 怎么填：
 *   1. 建一个**私有**仓库（比如 tandian-data），里面不用放任何文件
 *   2. 建一个 Fine-grained personal access token
 *      Repository access 必须选 **Only select repositories**，
 *      **只勾那一个仓库**；权限只给 **Contents: Read and write**
 *   3. ⚠️ 如果误选成 All repositories，拿到 token 的人能删掉你所有工程。
 *      这是真的会点错的地方，务必确认下拉框里只有一行。
 *   4. token 在 ⚙️ 管理页里填，不写进代码
 *
 * 想关掉共享：把下面 GH 置空（null）即可，应用退回纯单机。
 */

export const GH = {
  owner: 'Toylog123',
  repo: 'tandian-data',
  dataPath: 'data.json',
  photoPath: 'photos.json',
};
