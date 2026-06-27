'use client';

import React, { useRef, useState } from 'react';

export default function WorkflowDiagram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    
    // Don't drag if clicking buttons/inputs/links
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('input')) {
      return;
    }

    setIsDragging(true);
    setStartX(e.pageX - containerRef.current.offsetLeft);
    setStartY(e.pageY - containerRef.current.offsetTop);
    setScrollLeft(containerRef.current.scrollLeft);
    setScrollTop(containerRef.current.scrollTop);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const y = e.pageY - containerRef.current.offsetTop;
    const walkX = (x - startX) * 1.5;
    const walkY = (y - startY) * 1.5;
    containerRef.current.scrollLeft = scrollLeft - walkX;
    containerRef.current.scrollTop = scrollTop - walkY;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  return (
    <div
      ref={containerRef}
      className={`workflow-diagram-container${isDragging ? ' dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <div className="workflow-tree">
        {/* Node 1: Start & Listen */}
        <div className="workflow-node start-node">
          <div className="node-icon">📡</div>
          <div className="node-content">
            <span className="node-tag">Bước 1: Trigger</span>
            <h5 className="node-title">Lắng nghe nhóm nguồn</h5>
            <p className="node-text">Bot theo dõi mọi tin nhắn mới trong nhóm công trình được chọn.</p>
          </div>
        </div>

        {/* Down Arrow */}
        <div className="workflow-arrow-v">
          <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
            <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
          </svg>
        </div>

        {/* Node 2: Forward & Ask Approval */}
        <div className="workflow-node action-node">
          <div className="node-icon">🤖</div>
          <div className="node-content">
            <span className="node-tag">Bước 2: Phê duyệt sơ bộ</span>
            <h5 className="node-title">Bot forward &amp; Hỏi ý kiến</h5>
            <p className="node-text">
              Bot gửi tin nhắn tới nhóm đích kèm 2 nút tương tác. Với tin CT hợp lệ, sau khi duyệt sẽ bật nhánh chọn nhà cung ứng:
            </p>
            <div className="node-options-inline">
              <span className="opt-badge opt-agree"><i className="fa-solid fa-check" /> Đồng ý</span>
              <span className="opt-badge opt-disagree"><i className="fa-solid fa-xmark" /> Không đồng ý</span>
            </div>
          </div>
        </div>

        {/* Down Arrow */}
        <div className="workflow-arrow-v">
          <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
            <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
          </svg>
        </div>

        {/* Split Section */}
        <div className="workflow-split-container">
          <div className="workflow-split-line">
            <div className="split-horizontal-line"></div>
          </div>

          <div className="workflow-branches">
            {/* Branch Left: Disagree */}
            <div className="workflow-branch branch-left">
              <span className="branch-label label-disagree">Không đồng ý</span>
              <div className="workflow-arrow-v">
                <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                  <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                </svg>
              </div>
              <div className="workflow-node end-node">
                <div className="node-icon">❌</div>
                <div className="node-content">
                  <h5 className="node-title">Thông báo từ chối</h5>
                  <p className="node-text">Gửi thông báo huỷ/từ chối vào nhóm được chỉ định.</p>
                </div>
              </div>
            </div>

            {/* Branch Right: Agree */}
            <div className="workflow-branch branch-right">
              <span className="branch-label label-agree">Đồng ý</span>
              <div className="workflow-arrow-v">
                <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                  <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                </svg>
              </div>

              {/* Node 3: Material Supply Options */}
              <div className="workflow-node action-node">
                <div className="node-icon">📝</div>
                <div className="node-content">
                  <span className="node-tag">Bước 3: Lựa chọn vật tư</span>
                  <h5 className="node-title">Hỏi phương án cung cấp</h5>
                  <p className="node-text">Hỏi ý kiến nhóm đích với 3 phương án phản hồi. Có thể giới hạn nhiều topic nhà cung ứng để chỉ nhận phản hồi đúng nơi đã cấu hình:</p>
                  <div className="node-options-list">
                    <div className="opt-item"><i className="fa-solid fa-circle-dot" /> Đồng ý cung cấp vật tư</div>
                    <div className="opt-item"><i className="fa-solid fa-circle-dot" /> Không đồng ý cung cấp vật tư</div>
                    <div className="opt-item"><i className="fa-solid fa-circle-dot" /> Yêu cầu thay đổi vật tư</div>
                  </div>
                </div>
              </div>

              {/* Down Arrow */}
              <div className="workflow-arrow-v">
                <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                  <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
                </svg>
              </div>

              {/* Second Split: Material Actions */}
              <div className="workflow-split-container">
                <div className="workflow-split-line">
                  <div className="split-horizontal-line"></div>
                </div>

                <div className="workflow-branches">
                  {/* Sub-branch Left: Reject */}
                  <div className="workflow-branch branch-left">
                    <span className="branch-label label-neutral">Không đồng ý / Thay đổi</span>
                    <div className="workflow-arrow-v">
                      <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                        <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                      </svg>
                    </div>
                    <div className="workflow-node end-node">
                      <div className="node-icon">📢</div>
                      <div className="node-content">
                        <h5 className="node-title">Thông báo yêu cầu thay đổi vật tư</h5>
                        <p className="node-text">Gửi thông báo để nhà cung ứng reply nội dung thay đổi, sau đó bot chuyển tiếp sang nhóm cấu hình.</p>
                      </div>
                    </div>
                  </div>

                  {/* Sub-branch Right: Agree Supply */}
                  <div className="workflow-branch branch-right">
                    <span className="branch-label label-agree">Đồng ý cấp</span>
                    <div className="workflow-arrow-v">
                      <svg width="2" height="20" viewBox="0 0 2 20" fill="none">
                        <line x1="1" y1="0" x2="1" y2="20" stroke="var(--border-color)" strokeWidth="2" />
                      </svg>
                    </div>

                    {/* Node 4: Send Notification & Await Reply */}
                    <div className="workflow-node action-node">
                      <div className="node-icon">📦</div>
                      <div className="node-content">
                        <span className="node-tag">Bước 4: Giao nhận</span>
                        <h5 className="node-title">Yêu cầu phản hồi khi nhận</h5>
                        <p className="node-text">
                          Thông báo vật tư đang đến và yêu cầu: <strong>"Khi vật tư đến hãy reply vào tin nhắn này"</strong>.
                        </p>
                      </div>
                    </div>

                    {/* Down Arrow */}
                    <div className="workflow-arrow-v">
                      <svg width="2" height="30" viewBox="0 0 2 30" fill="none">
                        <line x1="1" y1="0" x2="1" y2="30" stroke="var(--border-color)" strokeWidth="2" strokeDasharray="3 3" />
                      </svg>
                    </div>

                    {/* Node 5: User Replies -> Inspected */}
                    <div className="workflow-node success-node">
                      <div className="node-icon">✅</div>
                      <div className="node-content">
                        <span className="node-tag">Bước 5: Nghiệm thu</span>
                        <h5 className="node-title">Nghiệm thu vật tư hoàn tất</h5>
                        <p className="node-text">
                          Khi có phản hồi (reply), hệ thống tự động thông báo đã nghiệm thu vật tư vào group chat hoặc topic cấu hình.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
